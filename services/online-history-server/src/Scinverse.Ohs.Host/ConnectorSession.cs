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
    ILogger<ConnectorSession> logger,
    Action? onData = null,
    Func<ConnectorLinkStateChange, Task>? onLinkState = null)
{
    private CancellationTokenSource? _cts;
    private Task? _pumpTask;
    private Task? _linkPumpTask;

    public IMarketConnector Connector => connector;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var sourceId = await sourceStore.ResolveIdAsync(connector.SourceCode, cancellationToken).ConfigureAwait(false);
        _cts = new CancellationTokenSource();
        _pumpTask = PumpAsync(sourceId, _cts.Token);
        _linkPumpTask = PumpLinkStateAsync(_cts.Token);
    }

    public async Task StopAsync()
    {
        if (_cts is not null)
        {
            await _cts.CancelAsync().ConfigureAwait(false);
        }

        // При обрыве: pumps / TRANSAQ SendCommand(disconnect) — sync DLL, 20–50 с.
        // Жёсткий потолок, иначе тумблер «жёлтый halt» и повторные /disconnect.
        const int stopBudgetMs = 2_500;
        var sw = System.Diagnostics.Stopwatch.StartNew();

        try
        {
            var pumpBudget = TimeSpan.FromMilliseconds(Math.Max(200, stopBudgetMs - (int)sw.ElapsedMilliseconds));
            await Task.WhenAll(WaitPumpAsync(_pumpTask), WaitPumpAsync(_linkPumpTask))
                .WaitAsync(pumpBudget)
                .ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            logger.LogWarning(
                "ConnectorSession.StopAsync: pumps не завершились за {Ms} мс",
                (int)sw.ElapsedMilliseconds);
        }

        // SendCommand синхронный — выносим в ThreadPool, иначе WaitAsync не сработает.
        var teardownBudget = TimeSpan.FromMilliseconds(Math.Max(200, stopBudgetMs - (int)sw.ElapsedMilliseconds));
        try
        {
            await Task.Run(async () =>
                {
                    try
                    {
                        await connector.DisconnectAsync(CancellationToken.None).ConfigureAwait(false);
                    }
                    catch (InvalidOperationException)
                    {
                        // best-effort
                    }

                    try
                    {
                        await connector.DisposeAsync().ConfigureAwait(false);
                    }
                    catch (Exception ex)
                    {
                        logger.LogWarning(ex, "ConnectorSession.StopAsync: DisposeAsync");
                    }
                })
                .WaitAsync(teardownBudget)
                .ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            logger.LogWarning(
                "ConnectorSession.StopAsync: Disconnect/Dispose TRANSAQ превысили бюджет {Ms} мс — бросаем",
                stopBudgetMs);
        }

        _cts?.Dispose();
    }

    private static async Task WaitPumpAsync(Task? pump)
    {
        if (pump is null)
        {
            return;
        }

        try
        {
            await pump.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Штатная остановка pump.
        }
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
                            // Cache-hit (свежий каталог) — no-op; stale hit — фоновый persist;
                            // miss — буфер + батч по порогу (не транзакция на каждый SecurityInfo).
                            registry.Observe(security);
                            await registry.TryFlushMissThresholdAsync(cancellationToken).ConfigureAwait(false);
                            break;

                        case TradeEvent trade:
                            await registry.FlushPendingAsync(cancellationToken).ConfigureAwait(false);
                            if (normalizer.TryNormalize(trade, sourceId, out var record))
                            {
                                await batcher.EnqueueAsync(record, cancellationToken).ConfigureAwait(false);
                                coverageTracker.Track(trade.Key, record.Timestamp);
                                onData?.Invoke();
                            }
                            else
                            {
                                logger.LogDebug("Сделка по незарегистрированному инструменту {Key} отброшена", trade.Key);
                            }

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

    private async Task PumpLinkStateAsync(CancellationToken cancellationToken)
    {
        try
        {
            await foreach (var change in connector.LinkStateChanges.ReadAllAsync(cancellationToken).ConfigureAwait(false))
            {
                // Await, а не fire-and-forget: смены связи обрабатываются строго последовательно, иначе
                // Down/Degraded/Live гонятся и previous-состояние (детект recovering) считается неверно.
                // Ошибка одного тика (пул БД, fan-out) НЕ должна убивать pump — иначе Host
                // перестаёт видеть Degraded/Down («не чувствует разрыв»).
                if (onLinkState is null)
                {
                    continue;
                }

                try
                {
                    await onLinkState(change).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    logger.LogError(
                        ex,
                        "Ошибка обработки смены связи {State} — link pump продолжает",
                        change.State);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Штатное завершение link pump.
        }
    }
}
