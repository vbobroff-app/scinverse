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
    Lazy<ILivenessWriter> liveness,
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
        await liveness.Value.OnDataAsync(connectionId, cancellationToken).ConfigureAwait(false);
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
            try
            {
                await connector.UnsubscribeTradesAsync([recording.Key], cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Отписка best-effort: связь могла отвалиться (напр. авто-стоп по концу сессии уже после
                // обрыва). Не даём этому сорвать корректное закрытие сегмента как 'stopped'.
                logger.LogWarning(
                    ex, "Отписка {Instrument} при стопе не удалась (связь недоступна?) — закрываю сегмент",
                    recording.Key);
            }
        }

        await coverage.CloseAsync(recording.Key, "stopped", cancellationToken).ConfigureAwait(false);
        broadcaster.Broadcast(new RecordingStoppedEvent(instrumentId));
        await liveness.Value.OnRecordingStoppedAsync(recording.ConnectionId, cancellationToken).ConfigureAwait(false);
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

    public bool IsRecording(long instrumentId) => _recordings.ContainsKey(instrumentId);

    public bool HasRecordingsOnConnection(long connectionId) =>
        _recordings.Values.Any(r => r.ConnectionId == connectionId);

    /// <summary>
    /// Связь потеряна (phase 7h.4): закрываем открытые сегменты с причиной, намерение записи сохраняем.
    /// </summary>
    public async Task OnLinkDownAsync(
        long connectionId, string segmentStatus, DateTimeOffset at, CancellationToken cancellationToken)
    {
        foreach (var recording in _recordings.Values.Where(r => r.ConnectionId == connectionId).ToList())
        {
            if (!coverage.IsActive(recording.Key))
            {
                continue;
            }

            await coverage.CloseAsync(recording.Key, segmentStatus, cancellationToken, at).ConfigureAwait(false);
            logger.LogInformation(
                "Связь подключения {ConnectionId} потеряна — сегмент {SegmentId} закрыт ({Status})",
                connectionId, recording.SegmentId, segmentStatus);
        }
    }

    /// <summary>
    /// Связь восстановлена (phase 7h.4): ре-подписка и новый сегмент для активных записей.
    /// </summary>
    public async Task OnLinkLiveAsync(long connectionId, CancellationToken cancellationToken)
    {
        var connector = connections.GetConnector(connectionId);
        if (connector is null)
        {
            logger.LogWarning("Ре-подписка: подключение {ConnectionId} не найдено", connectionId);
            return;
        }

        foreach (var recording in _recordings.Values.Where(r => r.ConnectionId == connectionId).ToList())
        {
            if (coverage.IsActive(recording.Key))
            {
                continue;
            }

            if (!registry.TryResolveById(recording.InstrumentId, out var instrument))
            {
                logger.LogWarning("Ре-подписка: инструмент {InstrumentId} не найден", recording.InstrumentId);
                continue;
            }

            await connector.SubscribeTradesAsync([recording.Key], cancellationToken).ConfigureAwait(false);
            var (segmentId, startedAt) = await coverage
                .OpenAsync(instrument, recording.SourceId, cancellationToken)
                .ConfigureAwait(false);
            _recordings[recording.InstrumentId] = recording with { SegmentId = segmentId, StartedAt = startedAt };
            broadcaster.Broadcast(new RecordingStartedEvent(
                recording.InstrumentId, recording.SourceId, connectionId, segmentId));
            logger.LogInformation(
                "Связь восстановлена — ре-подписка {Instrument}, новый сегмент {SegmentId}",
                recording.Key, segmentId);
        }

        if (HasRecordingsOnConnection(connectionId))
        {
            await liveness.Value.OnDataAsync(connectionId, cancellationToken).ConfigureAwait(false);
        }
    }

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
