using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Оркестратор write-path: connect → subscribe → parse (ACL) → normalize → batch → write.
/// </summary>
public sealed class OhsWorker : BackgroundService
{
    private readonly IMarketConnector _connector;
    private readonly ITransaqParser _parser;
    private readonly IInstrumentRegistry _registry;
    private readonly TradeNormalizer _normalizer;
    private readonly TradeBatcher _batcher;
    private readonly OhsOptions _options;
    private readonly ILogger<OhsWorker> _logger;

    public OhsWorker(
        IMarketConnector connector,
        ITransaqParser parser,
        IInstrumentRegistry registry,
        TradeNormalizer normalizer,
        TradeBatcher batcher,
        OhsOptions options,
        ILogger<OhsWorker> logger)
    {
        _connector = connector;
        _parser = parser;
        _registry = registry;
        _normalizer = normalizer;
        _batcher = batcher;
        _options = options;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await _registry.InitializeAsync(stoppingToken).ConfigureAwait(false);

        var batcherTask = _batcher.RunAsync(stoppingToken);

        await _connector.ConnectAsync(stoppingToken).ConfigureAwait(false);

        var instruments = _options.Instruments
            .Select(instrument => new InstrumentKey(instrument.Seccode, instrument.Board))
            .ToList();

        _logger.LogInformation("Подписка на ленту сделок: {Count} инструментов", instruments.Count);
        await _connector.SubscribeTradesAsync(instruments, stoppingToken).ConfigureAwait(false);

        var accepted = 0L;
        try
        {
            await foreach (var xml in _connector.Messages.ReadAllAsync(stoppingToken).ConfigureAwait(false))
            {
                foreach (var message in _parser.Parse(xml))
                {
                    switch (message)
                    {
                        case SecurityInfo security:
                            await _registry.RegisterAsync(security, stoppingToken).ConfigureAwait(false);
                            break;

                        case TradeEvent trade when _normalizer.TryNormalize(trade, out var record):
                            await _batcher.EnqueueAsync(record, stoppingToken).ConfigureAwait(false);
                            accepted++;
                            break;

                        case TradeEvent trade:
                            _logger.LogDebug("Сделка по незарегистрированному инструменту {Key} отброшена", trade.Key);
                            break;
                    }
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Штатное завершение.
        }

        _batcher.Complete();
        await batcherTask.ConfigureAwait(false);

        _logger.LogInformation("Конвейер остановлен. Принято сделок: {Count}", accepted);
    }
}
