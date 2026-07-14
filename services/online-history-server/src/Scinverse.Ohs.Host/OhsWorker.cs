using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Фоновой процесс control-plane: держит батчер записи, heartbeat покрытия, живость и
/// Supervisor автозаписи; запись стартует/останавливается через API / Supervisor.
/// На остановке хоста аккуратно закрывает записи и подключения.
/// </summary>
public sealed class OhsWorker(
    TradeBatcher batcher,
    CoverageTracker coverageTracker,
    RecordingManager recordingManager,
    ConnectionManager connectionManager,
    LivenessProbe livenessProbe,
    RecordingSupervisor recordingSupervisor,
    ILogger<OhsWorker> logger) : BackgroundService
{
    private static readonly TimeSpan HeartbeatInterval = TimeSpan.FromSeconds(2);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("OHS control-plane запущен");

        var batcherTask = batcher.RunAsync(stoppingToken);
        var heartbeatTask = coverageTracker.RunHeartbeatAsync(HeartbeatInterval, stoppingToken);
        var livenessTask = livenessProbe.RunAsync(stoppingToken);
        var supervisorTask = recordingSupervisor.RunAsync(stoppingToken);

        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Запрошена остановка.
        }

        await supervisorTask.ConfigureAwait(false);
        await livenessTask.ConfigureAwait(false);
        await heartbeatTask.ConfigureAwait(false);
        await recordingManager.StopAllAsync(CancellationToken.None).ConfigureAwait(false);
        await connectionManager.StopAllAsync(CancellationToken.None).ConfigureAwait(false);

        batcher.Complete();
        await batcherTask.ConfigureAwait(false);

        logger.LogInformation("OHS control-plane остановлен");
    }
}
