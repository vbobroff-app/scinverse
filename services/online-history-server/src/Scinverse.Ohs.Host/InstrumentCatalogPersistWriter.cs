using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Фоновая батч-запись справочника после invalidate (startup-latency #2+#3): drain очереди,
/// UpsertBatch, по idle помечает каталог снова свежим; сигналит lifecycle для basket sync.
/// </summary>
public sealed class InstrumentCatalogPersistWriter(
    InstrumentCatalogPersistQueue queue,
    IInstrumentStore store,
    IInstrumentRegistry registry,
    CatalogRefreshNc catalogRefreshNc,
    Lazy<InstrumentLifecycleService> lifecycle,
    ILogger<InstrumentCatalogPersistWriter> logger) : BackgroundService
{
    private const int MaxBatch = 500;
    private static readonly TimeSpan FreshIdle = TimeSpan.FromSeconds(3);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var batch = new List<SecurityInfo>(capacity: 64);
        var hadWork = false;

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                batch.Clear();

                // Ждём первый элемент или таймаут idle→MarkFresh.
                using var idleCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                idleCts.CancelAfter(FreshIdle);

                SecurityInfo? first = null;
                try
                {
                    first = await queue.Reader.ReadAsync(idleCts.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
                {
                    // Idle: если после invalidate очередь пуста и была работа / stale — свежий.
                    if (hadWork && !registry.IsFresh && queue.ApproxCount == 0)
                    {
                        registry.MarkFresh();
                        var refreshPending = catalogRefreshNc.OnCatalogMarkedFresh();
                        if (refreshPending)
                        {
                            // Force: Refresh dump закрыт — baskets ещё раз, даже если sync уже был сегодня.
                            await lifecycle.Value
                                .TrySyncBasketsAfterDumpAsync(force: true, stoppingToken)
                                .ConfigureAwait(false);
                        }
                        else
                        {
                            lifecycle.Value.OnAvailablePersisted();
                        }

                        logger.LogInformation("Справочник инструментов снова помечен свежим (idle persist)");
                        hadWork = false;
                    }

                    continue;
                }

                hadWork = true;
                batch.Add(first);
                while (batch.Count < MaxBatch && queue.Reader.TryRead(out var more))
                {
                    batch.Add(more);
                }

                // Дедуп по ключу внутри пачки.
                var dedup = new Dictionary<InstrumentKey, SecurityInfo>(batch.Count);
                foreach (var item in batch)
                {
                    dedup[item.Key] = item;
                }

                try
                {
                    var saved = await store
                        .UpsertBatchAsync(dedup.Values.ToList(), stoppingToken)
                        .ConfigureAwait(false);
                    registry.ApplyPersisted(saved);
                    lifecycle.Value.OnAvailablePersisted();
                    logger.LogDebug(
                        "Справочник: фоновый upsert {Count} инструментов (очередь ≈{Queued})",
                        saved.Count, queue.ApproxCount);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogError(ex, "Не удалось записать пачку справочника ({Count})", dedup.Count);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Штатная остановка Host.
        }
    }
}
