using System.Collections.Concurrent;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Оркестратор записей: динамический start/stop по (instrument, connection) в рантайме.
/// Подписку/отписку маршрутизирует на коннектор подключения, покрытие ведёт через
/// <see cref="CoverageTracker"/>. Ключ записи — instrumentId (одна запись на инструмент).
/// </summary>
public sealed class RecordingManager(
    ConnectionManager connections,
    CoverageTracker coverage,
    IInstrumentRegistry registry,
    ISourceStore sourceStore,
    WebSocketBroadcaster broadcaster,
    ILogger<RecordingManager> logger)
{
    private sealed record Recording(
        InstrumentKey Key, long InstrumentId, short SourceId, long ConnectionId, long SegmentId, DateTimeOffset StartedAt);

    private readonly ConcurrentDictionary<long, Recording> _recordings = new();

    public async Task<RecordingInfo> StartAsync(long instrumentId, long connectionId, CancellationToken cancellationToken)
    {
        if (_recordings.ContainsKey(instrumentId))
        {
            throw new InvalidOperationException($"Запись инструмента {instrumentId} уже идёт");
        }

        if (!registry.TryResolveById(instrumentId, out var instrument))
        {
            throw new InvalidOperationException($"Инструмент {instrumentId} не найден в реестре");
        }

        var connector = connections.GetConnector(connectionId)
            ?? throw new InvalidOperationException($"Подключение {connectionId} не в статусе connected");

        var sourceId = await sourceStore.ResolveIdAsync(connector.SourceCode, cancellationToken).ConfigureAwait(false);
        var (segmentId, startedAt) = await coverage.OpenAsync(instrument, sourceId, cancellationToken).ConfigureAwait(false);
        await connector.SubscribeTradesAsync([instrument.Key], cancellationToken).ConfigureAwait(false);

        var recording = new Recording(instrument.Key, instrumentId, sourceId, connectionId, segmentId, startedAt);
        _recordings[instrumentId] = recording;
        broadcaster.Broadcast(new RecordingStartedEvent(instrumentId, sourceId, connectionId, segmentId));
        logger.LogInformation("Старт записи {Instrument} через подключение {ConnectionId}", instrument.Key, connectionId);
        return ToInfo(recording);
    }

    public async Task StopAsync(long instrumentId, CancellationToken cancellationToken)
    {
        if (!_recordings.TryRemove(instrumentId, out var recording))
        {
            return;
        }

        var connector = connections.GetConnector(recording.ConnectionId);
        if (connector is not null)
        {
            await connector.UnsubscribeTradesAsync([recording.Key], cancellationToken).ConfigureAwait(false);
        }

        await coverage.CloseAsync(recording.Key, "stopped", cancellationToken).ConfigureAwait(false);
        broadcaster.Broadcast(new RecordingStoppedEvent(instrumentId));
        logger.LogInformation("Стоп записи {Instrument}", recording.Key);
    }

    public async Task StopAllAsync(CancellationToken cancellationToken)
    {
        foreach (var instrumentId in _recordings.Keys)
        {
            await StopAsync(instrumentId, cancellationToken).ConfigureAwait(false);
        }
    }

    public IReadOnlyList<RecordingInfo> List() => _recordings.Values.Select(ToInfo).ToList();

    private RecordingInfo ToInfo(Recording recording) => new(
        recording.InstrumentId,
        recording.Key.Ticker,
        recording.Key.Board,
        recording.SourceId,
        recording.ConnectionId,
        recording.SegmentId,
        recording.StartedAt,
        coverage.CurrentCount(recording.Key));
}

/// <summary>Снимок активной записи (для API).</summary>
public sealed record RecordingInfo(
    long InstrumentId,
    string Ticker,
    string Board,
    short SourceId,
    long ConnectionId,
    long SegmentId,
    DateTimeOffset StartedAt,
    long TradeCount);
