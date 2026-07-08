using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Оркестратор write-path: connect → start recordings (subscribe + coverage) → parse (ACL)
/// → normalize → batch → write, с heartbeat покрытия и закрытием сегментов на остановке.
/// </summary>
public sealed class OhsWorker(
    IMarketConnector connector,
    ITransaqParser parser,
    IInstrumentRegistry registry,
    ISourceStore sourceStore,
    RecordingManager recordingManager,
    TradeNormalizer normalizer,
    TradeBatcher batcher,
    OhsOptions options,
    ILogger<OhsWorker> logger) : BackgroundService
{
    private static readonly TimeSpan HeartbeatInterval = TimeSpan.FromSeconds(2);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await registry.InitializeAsync(stoppingToken).ConfigureAwait(false);

        // Источник — свойство коннектора; резолвим его код в source_id один раз на старте.
        var sourceId = await sourceStore.ResolveIdAsync(connector.SourceCode, stoppingToken).ConfigureAwait(false);
        logger.LogInformation("Источник данных: {Source} (source_id={SourceId})", connector.SourceCode, sourceId);

        var batcherTask = batcher.RunAsync(stoppingToken);

        await connector.ConnectAsync(stoppingToken).ConfigureAwait(false);

        var instruments = options.Instruments
            .Select(instrument => new InstrumentKey(instrument.Ticker, instrument.Board))
            .ToList();

        logger.LogInformation("Старт записи: {Count} инструментов", instruments.Count);
        foreach (var instrument in instruments)
        {
            await recordingManager.StartAsync(instrument, sourceId, stoppingToken).ConfigureAwait(false);
        }

        // Heartbeat покрытия останавливаем, как только завершился поток сообщений.
        using var recordingCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        var heartbeatTask = recordingManager.RunHeartbeatAsync(HeartbeatInterval, recordingCts.Token);

        var accepted = 0L;
        try
        {
            await foreach (var xml in connector.Messages.ReadAllAsync(stoppingToken).ConfigureAwait(false))
            {
                foreach (var message in parser.Parse(xml))
                {
                    switch (message)
                    {
                        case SecurityInfo security:
                            await registry.RegisterAsync(security, stoppingToken).ConfigureAwait(false);
                            break;

                        case TradeEvent trade when normalizer.TryNormalize(trade, sourceId, out var record):
                            await batcher.EnqueueAsync(record, stoppingToken).ConfigureAwait(false);
                            recordingManager.Track(trade.Key);
                            accepted++;
                            break;

                        case TradeEvent trade:
                            logger.LogDebug("Сделка по незарегистрированному инструменту {Key} отброшена", trade.Key);
                            break;
                    }
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Штатное завершение.
        }

        await recordingCts.CancelAsync().ConfigureAwait(false);
        await heartbeatTask.ConfigureAwait(false);
        await recordingManager.StopAllAsync("stopped", CancellationToken.None).ConfigureAwait(false);

        batcher.Complete();
        await batcherTask.ConfigureAwait(false);

        logger.LogInformation("Конвейер остановлен. Принято сделок: {Count}", accepted);
    }
}
