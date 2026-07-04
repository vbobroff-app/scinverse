using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Оркестратор write-path: connect → subscribe → parse (ACL) → normalize → batch → write.
/// </summary>
public sealed class OhsWorker(
    IMarketConnector connector,
    ITransaqParser parser,
    IInstrumentRegistry registry,
    TradeNormalizer normalizer,
    TradeBatcher batcher,
    OhsOptions options,
    ILogger<OhsWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await registry.InitializeAsync(stoppingToken).ConfigureAwait(false);

        var batcherTask = batcher.RunAsync(stoppingToken);

        await connector.ConnectAsync(stoppingToken).ConfigureAwait(false);

        var instruments = options.Instruments
            .Select(instrument => new InstrumentKey(instrument.Ticker, instrument.Board))
            .ToList();

        logger.LogInformation("Подписка на ленту сделок: {Count} инструментов", instruments.Count);
        await connector.SubscribeTradesAsync(instruments, stoppingToken).ConfigureAwait(false);

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

                        case TradeEvent trade when normalizer.TryNormalize(trade, out var record):
                            await batcher.EnqueueAsync(record, stoppingToken).ConfigureAwait(false);
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

        batcher.Complete();
        await batcherTask.ConfigureAwait(false);

        logger.LogInformation("Конвейер остановлен. Принято сделок: {Count}", accepted);
    }
}
