using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Суточный lifecycle Online-каталога: архивация просроченных FUT/OPT по <c>derivative.expiration</c>.
/// </summary>
public sealed class InstrumentLifecycleService(
    IInstrumentStore store,
    IInstrumentRegistry registry,
    IRecordingScheduleStore schedule,
    Lazy<RecordingManager> recordings,
    TimeProvider time,
    ILogger<InstrumentLifecycleService> logger)
{
    private readonly object _gate = new();
    private DateOnly? _lastSweepDay;

    /// <summary>
    /// Раз в день МСК (или <paramref name="force"/>): archive expired → evict cache →
    /// disable Auto → stop open recordings.
    /// </summary>
    public async Task<InstrumentLifecycleSweepResult> TrySweepAsync(
        bool force, CancellationToken cancellationToken)
    {
        var today = InstrumentLifecycle.TodayMoscow(time);
        lock (_gate)
        {
            if (!force && _lastSweepDay == today)
            {
                return new InstrumentLifecycleSweepResult(false, []);
            }
        }

        var archived = await store.ArchiveExpiredAsync(today, cancellationToken).ConfigureAwait(false);
        lock (_gate)
        {
            _lastSweepDay = today;
        }

        if (archived.Count == 0)
        {
            logger.LogDebug("Lifecycle sweep: нет просроченных к архивации (today={Today})", today);
            return new InstrumentLifecycleSweepResult(true, []);
        }

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
            "Lifecycle sweep: архивировано {Count} инструмент(ов) с expiration < {Today}",
            archived.Count, today);
        return new InstrumentLifecycleSweepResult(true, archived);
    }
}
