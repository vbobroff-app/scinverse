using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Живая сессия одного коннектора: pump-цикл читает сырой поток, гоняет
/// parser → normalizer → batcher и учитывает принятые сделки в покрытии.
/// </summary>
public sealed class ConnectorSession(
    IMarketConnector connector,
    ITransaqParser parser,
    IInstrumentRegistry registry,
    ISourceStore sourceStore,
    TradeNormalizer normalizer,
    TradeBatcher batcher,
    CoverageTracker coverageTracker,
    ILogger<ConnectorSession> logger)
{
    private CancellationTokenSource? _cts;
    private Task? _pumpTask;

    public IMarketConnector Connector => connector;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var sourceId = await sourceStore.ResolveIdAsync(connector.SourceCode, cancellationToken).ConfigureAwait(false);
        _cts = new CancellationTokenSource();
        _pumpTask = PumpAsync(sourceId, _cts.Token);
    }

    public async Task StopAsync()
    {
        if (_cts is not null)
        {
            await _cts.CancelAsync().ConfigureAwait(false);
        }

        if (_pumpTask is not null)
        {
            try
            {
                await _pumpTask.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Штатная остановка pump.
            }
        }

        try
        {
            await connector.DisconnectAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch (InvalidOperationException)
        {
            // best-effort disconnect
        }

        await connector.DisposeAsync().ConfigureAwait(false);
        _cts?.Dispose();
    }

    private async Task PumpAsync(short sourceId, CancellationToken cancellationToken)
    {
        try
        {
            await foreach (var xml in connector.Messages.ReadAllAsync(cancellationToken).ConfigureAwait(false))
            {
                foreach (var message in parser.Parse(xml))
                {
                    switch (message)
                    {
                        case SecurityInfo security:
                            await registry.RegisterAsync(security, cancellationToken).ConfigureAwait(false);
                            break;

                        case TradeEvent trade when normalizer.TryNormalize(trade, sourceId, out var record):
                            await batcher.EnqueueAsync(record, cancellationToken).ConfigureAwait(false);
                            coverageTracker.Track(trade.Key);
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
            // Штатное завершение pump.
        }
    }
}
