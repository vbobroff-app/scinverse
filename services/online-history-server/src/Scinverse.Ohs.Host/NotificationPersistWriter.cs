using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Фоновая запись ленты уведомлений в долговременный аудит-лог (phase 11.2 persistence): на старте
/// прогревает ring-buffer хаба последними N из БД (чтобы лента переживала рестарт Host), затем дренит
/// <see cref="NotificationPersistQueue"/> и батч-инсертит. Ошибки БД логируются и не роняют публикацию
/// (аудит-лог — не критичный путь; хаб/WS работают независимо).
/// </summary>
public sealed class NotificationPersistWriter(
    NotificationPersistQueue queue,
    INotificationStore store,
    NotificationHub hub,
    ILogger<NotificationPersistWriter> logger) : BackgroundService
{
    private const int MaxBatch = 500;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await HydrateBufferAsync(stoppingToken);

        var batch = new List<NotificationRecord>(capacity: 64);
        try
        {
            await foreach (var evt in queue.Reader.ReadAllAsync(stoppingToken))
            {
                batch.Add(NotificationMapping.ToRecord(evt));
                while (batch.Count < MaxBatch && queue.Reader.TryRead(out var more))
                {
                    batch.Add(NotificationMapping.ToRecord(more));
                }

                try
                {
                    await store.AppendBatchAsync(batch, stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogError(ex, "Не удалось записать пачку уведомлений в лог ({Count})", batch.Count);
                }
                finally
                {
                    batch.Clear();
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Штатная остановка Host.
        }
    }

    private async Task HydrateBufferAsync(CancellationToken cancellationToken)
    {
        try
        {
            var recent = await store.QueryRecentAsync(NotificationHub.DefaultCapacity, cancellationToken);
            if (recent.Count > 0)
            {
                hub.Hydrate(recent.Select(NotificationMapping.ToDto).ToList());
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Гидратация ленты уведомлений из БД пропущена (лог продолжит работу)");
        }
    }
}
