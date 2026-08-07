using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Lifecycle Online-каталога: суточный archive + re-eval static baskets;
/// post-dump sync members после idle persist Available.
/// Гейт checkup-суток durable в <see cref="IRuntimeStateStore"/> — переживает рестарт Host.
/// </summary>
public sealed class InstrumentLifecycleService(
    IInstrumentStore store,
    IInstrumentRegistry registry,
    IRecordingScheduleStore schedule,
    Lazy<RecordingManager> recordings,
    BasketEvalService basketEval,
    ObservedCatalogCoordinator observedCatalog,
    CatalogRefreshNc catalogRefreshNc,
    IRuntimeStateStore runtimeState,
    TimeProvider time,
    ILogger<InstrumentLifecycleService> logger)
{
    public const string StateKeyCheckupDay = "catalog.checkup.last_day";
    public const string StateKeyPostDumpDay = "catalog.baskets.post_dump.last_day";

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
    /// Checkup-сутки: с 04:00 МСК — см. <see cref="InstrumentLifecycle.CheckupDayMoscow"/>.
    /// Старт Host sweep не вызывает; якорь = связь с data-сервером.
    /// </summary>
    public async Task<InstrumentLifecycleSweepResult> TrySweepAsync(
        bool force, CancellationToken cancellationToken)
    {
        var checkupDay = InstrumentLifecycle.CheckupDayMoscow(time);
        var calendarToday = InstrumentLifecycle.TodayMoscow(time);

        if (!force)
        {
            await EnsureDayLoadedAsync(
                () => _lastSweepDay,
                v => _lastSweepDay = v,
                StateKeyCheckupDay,
                cancellationToken).ConfigureAwait(false);

            lock (_gate)
            {
                if (_lastSweepDay == checkupDay)
                {
                    return new InstrumentLifecycleSweepResult(false, []);
                }

                _lastSweepDay = checkupDay;
                _forceNextPostDumpSync = true;
            }

            // Durable claim — иначе после рестарта Host Auto-connect снова откроет суточный Lifecycle.
            await PersistDayAsync(StateKeyCheckupDay, checkupDay, cancellationToken).ConfigureAwait(false);
        }
        else
        {
            lock (_gate)
            {
                _lastSweepDay = checkupDay;
                _forceNextPostDumpSync = true;
            }

            await PersistDayAsync(StateKeyCheckupDay, checkupDay, cancellationToken).ConfigureAwait(false);
        }

        // Archive по календарной дате экспирации; гейт частоты — checkup-сутки.
        var archived = await store.ArchiveExpiredAsync(calendarToday, cancellationToken).ConfigureAwait(false);

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
        var reEval = await basketEval.ReEvalAllConnectionsAsync(cancellationToken).ConfigureAwait(false);
        await observedCatalog.RebuildCacheAsync(cancellationToken).ConfigureAwait(false);

        // Разрешить persist hit-ов на следующем dump (свой суточный гейт в registry).
        registry.Invalidate(force: false);

        var result = new InstrumentLifecycleSweepResult(true, archived, reEval.Removed);
        if (!force)
        {
            catalogRefreshNc.PublishDailyLifecycle(result);
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

        bool claimForce;
        lock (_gate)
        {
            claimForce = force || _forceNextPostDumpSync;
        }

        if (!claimForce)
        {
            await EnsureDayLoadedAsync(
                () => _lastPostDumpBasketDay,
                v => _lastPostDumpBasketDay = v,
                StateKeyPostDumpDay,
                cancellationToken).ConfigureAwait(false);

            lock (_gate)
            {
                if (_lastPostDumpBasketDay == checkupDay)
                {
                    return false;
                }

                _lastPostDumpBasketDay = checkupDay;
                _forceNextPostDumpSync = false;
            }

            await PersistDayAsync(StateKeyPostDumpDay, checkupDay, cancellationToken).ConfigureAwait(false);
        }
        else
        {
            lock (_gate)
            {
                _lastPostDumpBasketDay = checkupDay;
                _forceNextPostDumpSync = false;
            }

            await PersistDayAsync(StateKeyPostDumpDay, checkupDay, cancellationToken).ConfigureAwait(false);
        }

        var reEval = await basketEval.ReEvalAllConnectionsAsync(cancellationToken).ConfigureAwait(false);
        await observedCatalog.RebuildCacheAsync(cancellationToken).ConfigureAwait(false);

        catalogRefreshNc.PublishBasketSyncAfterDump(reEval.Added);
        logger.LogInformation(
            "Lifecycle: post-dump basket sync (force={Force}, checkupDay={CheckupDay}, added={Added})",
            claimForce, checkupDay, reEval.Added.Count);
        return true;
    }

    private async Task EnsureDayLoadedAsync(
        Func<DateOnly?> getter,
        Action<DateOnly> setter,
        string stateKey,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (getter() is not null)
            {
                return;
            }
        }

        try
        {
            var raw = await runtimeState.GetAsync(stateKey, cancellationToken).ConfigureAwait(false);
            if (DateOnly.TryParse(raw, out var day))
            {
                lock (_gate)
                {
                    if (getter() is null)
                    {
                        setter(day);
                    }
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Lifecycle: не удалось прочитать runtime state {Key}", stateKey);
        }
    }

    private async Task PersistDayAsync(string stateKey, DateOnly day, CancellationToken cancellationToken)
    {
        try
        {
            await runtimeState
                .SetAsync(stateKey, day.ToString("yyyy-MM-dd"), cancellationToken)
                .ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Lifecycle: не удалось записать runtime state {Key}={Day}", stateKey, day);
        }
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
