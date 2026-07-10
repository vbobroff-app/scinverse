using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Фоновой процесс control-plane: держит батчер записи и heartbeat покрытия; запись
/// стартует/останавливается через API. На остановке хоста аккуратно закрывает записи и подключения.
/// </summary>
public sealed class OhsWorker(
    TradeBatcher batcher,
    CoverageTracker coverageTracker,
    RecordingManager recordingManager,
    ConnectionManager connectionManager,
    ILogger<OhsWorker> logger) : BackgroundService
{
    private static readonly TimeSpan HeartbeatInterval = TimeSpan.FromSeconds(2);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("OHS control-plane запущен");

        var batcherTask = batcher.RunAsync(stoppingToken);
        var heartbeatTask = coverageTracker.RunHeartbeatAsync(HeartbeatInterval, stoppingToken);

        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Запрошена остановка.
        }

        await heartbeatTask.ConfigureAwait(false);
        await recordingManager.StopAllAsync(CancellationToken.None).ConfigureAwait(false);
        await connectionManager.StopAllAsync(CancellationToken.None).ConfigureAwait(false);

        batcher.Complete();
        await batcherTask.ConfigureAwait(false);

        logger.LogInformation("OHS control-plane остановлен");
    }
}
