using System.Collections.Concurrent;
using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Управляет активными записями: подписка коннектора + сегмент покрытия на (instrument, source).
/// 6a: старт по конфигу, heartbeat по мере записи, закрытие на остановке. Динамический
/// старт/стоп из UI и unsubscribe по инструменту — 6b.
/// </summary>
public sealed class RecordingManager(
    IMarketConnector connector,
    IInstrumentRegistry registry,
    ICoverageStore coverageStore,
    TimeProvider timeProvider,
    ILogger<RecordingManager> logger)
{
    private sealed class Recording(long segmentId)
    {
        public long SegmentId { get; } = segmentId;
        public long PendingDelta;
    }

    private readonly ConcurrentDictionary<InstrumentKey, Recording> _active = new();

    /// <summary>Подписывает инструмент и открывает сегмент покрытия.</summary>
    public async Task StartAsync(InstrumentKey instrument, short sourceId, CancellationToken cancellationToken)
    {
        await connector.SubscribeTradesAsync([instrument], cancellationToken).ConfigureAwait(false);

        if (!registry.TryResolve(instrument, out var resolved))
        {
            logger.LogWarning(
                "Запись {Instrument}: инструмент не в реестре, сегмент покрытия не открыт", instrument);
            return;
        }

        var segmentId = await coverageStore
            .OpenAsync(resolved.InstrumentId, sourceId, timeProvider.GetUtcNow(), cancellationToken)
            .ConfigureAwait(false);

        _active[instrument] = new Recording(segmentId);
        logger.LogInformation(
            "Запись {Instrument} (source_id={SourceId}) → сегмент {SegmentId}", instrument, sourceId, segmentId);
    }

    /// <summary>Учитывает принятую сделку (для heartbeat trade_count).</summary>
    public void Track(InstrumentKey instrument)
    {
        if (_active.TryGetValue(instrument, out var recording))
        {
            Interlocked.Increment(ref recording.PendingDelta);
        }
    }

    /// <summary>Периодически сбрасывает накопленные дельты в trade_count активных сегментов.</summary>
    public async Task RunHeartbeatAsync(TimeSpan interval, CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(interval);
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
            {
                await FlushDeltasAsync(cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // Штатная остановка heartbeat.
        }
    }

    /// <summary>Досбрасывает дельты и закрывает все активные сегменты.</summary>
    public async Task StopAllAsync(string status, CancellationToken cancellationToken)
    {
        await FlushDeltasAsync(cancellationToken).ConfigureAwait(false);

        foreach (var (instrument, recording) in _active)
        {
            await coverageStore
                .CloseAsync(recording.SegmentId, timeProvider.GetUtcNow(), status, cancellationToken)
                .ConfigureAwait(false);
            logger.LogInformation("Запись {Instrument} остановлена: сегмент {SegmentId} закрыт ({Status})",
                instrument, recording.SegmentId, status);
        }

        _active.Clear();
    }

    private async Task FlushDeltasAsync(CancellationToken cancellationToken)
    {
        foreach (var recording in _active.Values)
        {
            var delta = Interlocked.Exchange(ref recording.PendingDelta, 0);
            await coverageStore.ExtendAsync(recording.SegmentId, delta, cancellationToken).ConfigureAwait(false);
        }
    }
}
