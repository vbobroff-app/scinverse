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
    ConnectionSupervisor connectionSupervisor,
    ILogger<OhsWorker> logger) : BackgroundService
{
    private static readonly TimeSpan HeartbeatInterval = TimeSpan.FromSeconds(2);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("OHS control-plane запущен");
        connectionManager.RequestSupervisorNudge = connectionSupervisor.Nudge;
        connectionManager.OnBreakHandedOverAsync = connectionSupervisor.ReviewHandoverAsync;

        var batcherTask = RunBatcherResilientAsync(stoppingToken);
        var heartbeatTask = coverageTracker.RunHeartbeatAsync(HeartbeatInterval, stoppingToken);
        var livenessTask = livenessProbe.RunAsync(stoppingToken);
        var supervisorTask = recordingSupervisor.RunAsync(stoppingToken);
        var connectionSupervisorTask = connectionSupervisor.RunAsync(stoppingToken);

        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Запрошена остановка.
        }

        await connectionSupervisorTask.ConfigureAwait(false);
        await supervisorTask.ConfigureAwait(false);
        await livenessTask.ConfigureAwait(false);
        await heartbeatTask.ConfigureAwait(false);
        await recordingManager.StopAllAsync(CancellationToken.None).ConfigureAwait(false);
        await connectionManager.StopAllAsync(CancellationToken.None).ConfigureAwait(false);

        batcher.Complete();
        await batcherTask.ConfigureAwait(false);

        logger.LogInformation("OHS control-plane остановлен");
    }

    /// <summary>
    /// TradeBatcher.RunAsync падает целиком на ошибке WriteAsync (пул БД и т.п.) —
    /// без рестарта сделки копятся только в памяти (coverage tradeCount), в md_trade тишина.
    /// </summary>
    private async Task RunBatcherResilientAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await batcher.RunAsync(stoppingToken).ConfigureAwait(false);
                return;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "TradeBatcher упал — перезапуск через 1 с");
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
        }
    }
}
