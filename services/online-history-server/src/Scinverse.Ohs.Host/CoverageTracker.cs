using System.Collections.Concurrent;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Учёт покрытия по активным записям: открывает сегмент, копит принятые сделки и периодически
/// (heartbeat) сбрасывает их в trade_count + шлёт <see cref="CoverageExtendedEvent"/>; закрывает сегмент.
/// Ключ — <see cref="InstrumentKey"/> (источник фиксируется в момент открытия).
/// </summary>
public sealed class CoverageTracker(
    ICoverageStore coverageStore,
    WebSocketBroadcaster broadcaster,
    TimeProvider timeProvider,
    ILogger<CoverageTracker> logger)
{
    private sealed class Entry(long segmentId, long instrumentId, short sourceId)
    {
        public long SegmentId { get; } = segmentId;
        public long InstrumentId { get; } = instrumentId;
        public short SourceId { get; } = sourceId;
        public long PendingDelta;
        public long TotalCount;
    }

    private readonly ConcurrentDictionary<InstrumentKey, Entry> _active = new();

    public async Task<(long SegmentId, DateTimeOffset StartedAt)> OpenAsync(
        Instrument instrument, short sourceId, CancellationToken cancellationToken)
    {
        var startedAt = timeProvider.GetUtcNow();
        var segmentId = await coverageStore
            .OpenAsync(instrument.InstrumentId, sourceId, startedAt, cancellationToken)
            .ConfigureAwait(false);

        _active[instrument.Key] = new Entry(segmentId, instrument.InstrumentId, sourceId);
        logger.LogInformation("Покрытие {Instrument} → сегмент {SegmentId}", instrument.Key, segmentId);
        return (segmentId, startedAt);
    }

    public void Track(InstrumentKey key)
    {
        if (_active.TryGetValue(key, out var entry))
        {
            Interlocked.Increment(ref entry.PendingDelta);
            Interlocked.Increment(ref entry.TotalCount);
        }
    }

    public long CurrentCount(InstrumentKey key) =>
        _active.TryGetValue(key, out var entry) ? Interlocked.Read(ref entry.TotalCount) : 0;

    public async Task RunHeartbeatAsync(TimeSpan interval, CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(interval);
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
            {
                await FlushAsync(cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // Штатная остановка.
        }
        finally
        {
            await FlushAsync(CancellationToken.None).ConfigureAwait(false);
        }
    }

    public async Task CloseAsync(InstrumentKey key, string status, CancellationToken cancellationToken)
    {
        if (!_active.TryRemove(key, out var entry))
        {
            return;
        }

        var delta = Interlocked.Exchange(ref entry.PendingDelta, 0);
        await coverageStore.ExtendAsync(entry.SegmentId, delta, cancellationToken).ConfigureAwait(false);
        await coverageStore
            .CloseAsync(entry.SegmentId, timeProvider.GetUtcNow(), status, cancellationToken)
            .ConfigureAwait(false);
        logger.LogInformation("Покрытие {Instrument}: сегмент {SegmentId} закрыт ({Status})", key, entry.SegmentId, status);
    }

    private async Task FlushAsync(CancellationToken cancellationToken)
    {
        foreach (var entry in _active.Values)
        {
            var delta = Interlocked.Exchange(ref entry.PendingDelta, 0);
            if (delta <= 0)
            {
                continue;
            }

            await coverageStore.ExtendAsync(entry.SegmentId, delta, cancellationToken).ConfigureAwait(false);
            broadcaster.Broadcast(new CoverageExtendedEvent(
                entry.InstrumentId, entry.SourceId, timeProvider.GetUtcNow(), Interlocked.Read(ref entry.TotalCount)));
        }
    }
}
