using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Lifecycle Online-каталога: суточный archive + re-eval static baskets;
/// post-dump sync members после idle persist Available.
/// </summary>
public sealed class InstrumentLifecycleService(
    IInstrumentStore store,
    IInstrumentRegistry registry,
    IRecordingScheduleStore schedule,
    Lazy<RecordingManager> recordings,
    BasketEvalService basketEval,
    ObservedCatalogCoordinator observedCatalog,
    CatalogRefreshNc catalogRefreshNc,
    TimeProvider time,
    ILogger<InstrumentLifecycleService> logger)
{
    private static readonly TimeSpan AvailableIdle = TimeSpan.FromSeconds(3);

    private readonly object _gate = new();
    private DateOnly? _lastSweepDay;
    private DateOnly? _lastPostDumpBasketDay;
    private bool _forceNextPostDumpSync;
    private CancellationTokenSource? _availableIdleCts;

    /// <summary>
    /// Раз в checkup-сутки на первом успешном connect (или <paramref name="force"/> Refresh):
    /// archive expired → evict → Auto off / Stop → re-eval static → rebuild Observed;
    /// помечает dump к обновлению и ждёт post-dump sync после idle Available.
    /// Checkup-сутки: с 06:00 МСК (не календарная полночь) — см. <see cref="InstrumentLifecycle.CheckupDayMoscow"/>.
    /// Старт Host sweep не вызывает; якорь = связь с data-сервером.
    /// </summary>
    public async Task<InstrumentLifecycleSweepResult> TrySweepAsync(
        bool force, CancellationToken cancellationToken)
    {
        var checkupDay = InstrumentLifecycle.CheckupDayMoscow(time);
        var calendarToday = InstrumentLifecycle.TodayMoscow(time);
        lock (_gate)
        {
            if (!force && _lastSweepDay == checkupDay)
            {
                return new InstrumentLifecycleSweepResult(false, []);
            }
        }

        // Archive по календарной дате экспирации; гейт частоты — checkup-сутки.
        var archived = await store.ArchiveExpiredAsync(calendarToday, cancellationToken).ConfigureAwait(false);
        lock (_gate)
        {
            _lastSweepDay = checkupDay;
            // Refresh / суточный sweep: после dump Available ещё раз сверим baskets.
            _forceNextPostDumpSync = force || _forceNextPostDumpSync;
        }

        if (archived.Count > 0)
        {
            registry.Evict(archived);
            await schedule.DisableAutoManyAsync(archived, cancellationToken).ConfigureAwait(false);

            foreach (var instrumentId in archived)
            {
                try
                {
                    await recordings.Value.StopAsync(instrumentId, cancellationToken).ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogWarning(ex, "Lifecycle sweep: не удалось остановить запись {InstrumentId}", instrumentId);
                }
            }

            logger.LogInformation(
                "Lifecycle sweep: архивировано {Count} инструмент(ов) с expiration < {CalendarToday} (checkupDay={CheckupDay})",
                archived.Count, calendarToday, checkupDay);
        }
        else
        {
            logger.LogDebug(
                "Lifecycle sweep: нет просроченных (calendarToday={CalendarToday}, checkupDay={CheckupDay})",
                calendarToday, checkupDay);
        }

        // Немедленный re-eval: снять expired из members (Available уже без них).
        // Новые тикеры из сегодняшнего dump — в TrySyncBasketsAfterDumpAsync после idle.
        await basketEval.ReEvalAllConnectionsAsync(cancellationToken).ConfigureAwait(false);
        await observedCatalog.RebuildCacheAsync(cancellationToken).ConfigureAwait(false);

        // Разрешить persist hit-ов на следующем dump (свой суточный гейт в registry).
        registry.Invalidate(force: false);

        var result = new InstrumentLifecycleSweepResult(true, archived);
        if (!force)
        {
            catalogRefreshNc.PublishDailyCheckup(result);
        }

        return result;
    }

    /// <summary>
    /// Сигнал: Available только что записали (miss-flush / PersistQueue).
    /// Debounce idle → <see cref="TrySyncBasketsAfterDumpAsync"/>.
    /// </summary>
    public void OnAvailablePersisted()
    {
        var cts = new CancellationTokenSource();
        CancellationTokenSource? previous;
        lock (_gate)
        {
            previous = _availableIdleCts;
            _availableIdleCts = cts;
        }

        previous?.Cancel();
        previous?.Dispose();

        _ = DebouncePostDumpSyncAsync(cts);
    }

    /// <summary>
    /// После idle dump/persist: re-eval static + rebuild Observed (1×/checkup-сутки, или force).
    /// </summary>
    public async Task<bool> TrySyncBasketsAfterDumpAsync(bool force, CancellationToken cancellationToken)
    {
        var checkupDay = InstrumentLifecycle.CheckupDayMoscow(time);
        lock (_gate)
        {
            force = force || _forceNextPostDumpSync;
            if (!force && _lastPostDumpBasketDay == checkupDay)
            {
                return false;
            }

            _lastPostDumpBasketDay = checkupDay;
            _forceNextPostDumpSync = false;
        }

        await basketEval.ReEvalAllConnectionsAsync(cancellationToken).ConfigureAwait(false);
        await observedCatalog.RebuildCacheAsync(cancellationToken).ConfigureAwait(false);

        catalogRefreshNc.PublishBasketSyncAfterDump();
        logger.LogInformation(
            "Lifecycle: post-dump basket sync (force={Force}, checkupDay={CheckupDay})",
            force, checkupDay);
        return true;
    }

    private async Task DebouncePostDumpSyncAsync(CancellationTokenSource cts)
    {
        try
        {
            await Task.Delay(AvailableIdle, cts.Token).ConfigureAwait(false);
            bool force;
            lock (_gate)
            {
                force = _forceNextPostDumpSync;
            }

            await TrySyncBasketsAfterDumpAsync(force, CancellationToken.None).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Сбросили idle — ждём следующую паузу в dump/persist.
        }
        finally
        {
            lock (_gate)
            {
                if (ReferenceEquals(_availableIdleCts, cts))
                {
                    _availableIdleCts = null;
                }
            }

            cts.Dispose();
        }
    }
}
