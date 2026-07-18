using System.Collections.Concurrent;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Автомат соединения по расписанию (phase 7j): при Auto (<c>mode=scheduled</c>) поднимает/гасит
/// связь по окну суток + календарю ведущего <c>engine</c>. Тик = <see cref="OhsOptions.LivenessProbeSeconds"/>.
/// </summary>
public sealed class ConnectionSupervisor(
    IConnectionScheduleStore schedule,
    ConnectionManager connections,
    IMarketCalendar calendar,
    OhsOptions options,
    TimeProvider time,
    INotificationPublisher notifications,
    ILogger<ConnectionSupervisor> logger)
{
    private static readonly TimeSpan RetryPause = TimeSpan.FromSeconds(8);
    private const int MaxConnectAttempts = 5;

    private readonly SemaphoreSlim _wake = new(0, 1);
    private readonly ConcurrentDictionary<long, int> _failCounts = new();
    private readonly ConcurrentDictionary<long, DateTimeOffset> _nextAttemptAt = new();

    // Кэш ShapeSessions по (engine, date).
    private readonly Dictionary<(string Engine, DateOnly Date), TradingSession?> _sessionCache = new();

    public void Nudge()
    {
        try
        {
            _wake.Release();
        }
        catch (SemaphoreFullException)
        {
            // Уже разбужен.
        }
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        var tick = TimeSpan.FromSeconds(
            options.LivenessProbeSeconds > 0 ? options.LivenessProbeSeconds : 15);

        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await ReconcileAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Ошибка тика ConnectionSupervisor");
            }

            var delay = Task.Delay(tick, cancellationToken);
            var wake = _wake.WaitAsync(cancellationToken);
            await Task.WhenAny(delay, wake).ConfigureAwait(false);
        }
    }

    private async Task ReconcileAsync(CancellationToken cancellationToken)
    {
        var entries = await schedule.ListCurrentScheduledAsync(cancellationToken).ConfigureAwait(false);
        if (entries.Count == 0)
        {
            return;
        }

        var now = time.GetUtcNow();
        foreach (var entry in entries)
        {
            try
            {
                await ReconcileOneAsync(entry, now, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(
                    ex,
                    "ConnectionSupervisor: не удалось согласовать Auto для connection {ConnectionId}",
                    entry.ConnectionId);
            }
        }
    }

    private async Task ReconcileOneAsync(
        ConnectionScheduleEntry entry, DateTimeOffset nowUtc, CancellationToken cancellationToken)
    {
        var local = ToLocal(nowUtc, entry.Tz);
        var localTime = TimeOnly.FromDateTime(local.DateTime);
        var localDate = DateOnly.FromDateTime(local.DateTime);

        var session = await ResolveSessionAsync(entry.Engine, localDate, nowUtc, cancellationToken)
            .ConfigureAwait(false);
        var tradingDay = session is not null;
        var inWindow = ConnectionScheduleWindow.Contains(localTime, entry.WindowStart, entry.WindowEnd);
        var desiredConnected = tradingDay && inWindow;
        var isConnected = IsConnected(entry.ConnectionId);

        if (!desiredConnected)
        {
            _failCounts.TryRemove(entry.ConnectionId, out _);
            _nextAttemptAt.TryRemove(entry.ConnectionId, out _);
            if (isConnected)
            {
                await connections.DisconnectAsync(entry.ConnectionId, cancellationToken)
                    .ConfigureAwait(false);
                notifications.Publish(
                    "connection.schedule_disconnect",
                    $"Расписание: отключение {entry.ConnectionId} (вне окна / non-trading)",
                    "info",
                    data: new { entry.ConnectionId });
                logger.LogInformation(
                    "ConnectionSupervisor: disconnect {ConnectionId} (tradingDay={TradingDay}, inWindow={InWindow})",
                    entry.ConnectionId, tradingDay, inWindow);
            }

            return;
        }

        if (isConnected)
        {
            _failCounts.TryRemove(entry.ConnectionId, out _);
            _nextAttemptAt.TryRemove(entry.ConnectionId, out _);
            return;
        }

        if (_nextAttemptAt.TryGetValue(entry.ConnectionId, out var next) && nowUtc < next)
        {
            return;
        }

        var fails = _failCounts.GetValueOrDefault(entry.ConnectionId);
        if (fails >= MaxConnectAttempts)
        {
            return;
        }

        notifications.Publish(
            "connection.connecting",
            $"Расписание: подключение {entry.ConnectionId}, попытка {fails + 1}/{MaxConnectAttempts}",
            "info",
            data: new { entry.ConnectionId, attempt = fails + 1 });

        // Если по этому подключению открыт инцидент связи (lost, active) — переводим его в underway.
        // severity=warning: underway остаётся «жёлтым, ещё не решено» (маска фона в ленте).
        notifications.Progress(
            ConnectionManager.LinkIncidentSubject(entry.ConnectionId),
            "connection.reconnecting",
            $"Восстановление связи {entry.ConnectionId}: попытка {fails + 1}/{MaxConnectAttempts}",
            severity: "warning",
            data: new { entry.ConnectionId, attempt = fails + 1 });

        try
        {
            await connections.ConnectAsync(entry.ConnectionId, cancellationToken).ConfigureAwait(false);
            _failCounts.TryRemove(entry.ConnectionId, out _);
            _nextAttemptAt.TryRemove(entry.ConnectionId, out _);
            notifications.Publish(
                "connection.connected",
                $"Расписание: соединение {entry.ConnectionId} установлено",
                "info",
                data: new { entry.ConnectionId });
            logger.LogInformation(
                "ConnectionSupervisor: connect OK {ConnectionId}", entry.ConnectionId);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            var nextFails = _failCounts.AddOrUpdate(entry.ConnectionId, 1, (_, n) => n + 1);
            _nextAttemptAt[entry.ConnectionId] = nowUtc + RetryPause;
            logger.LogWarning(
                ex,
                "ConnectionSupervisor: connect fail {ConnectionId} ({Attempt}/{Max})",
                entry.ConnectionId, nextFails, MaxConnectAttempts);

            if (nextFails >= MaxConnectAttempts)
            {
                notifications.Publish(
                    "connection.connect_failed",
                    $"Расписание: не удалось подключить {entry.ConnectionId} за {MaxConnectAttempts} попыток",
                    "error",
                    data: new { entry.ConnectionId, attempts = nextFails });
            }
        }
    }

    private bool IsConnected(long connectionId)
    {
        var status = connections.GetStatus(connectionId);
        return status is "waiting" or "active" or "degraded";
    }

    private async Task<TradingSession?> ResolveSessionAsync(
        string engine, DateOnly localDate, DateTimeOffset nowUtc, CancellationToken cancellationToken)
    {
        var key = (engine, localDate);
        if (_sessionCache.TryGetValue(key, out var cached))
        {
            return cached;
        }

        // Для кэша на стыке суток — сбрасываем чужие даты.
        _sessionCache.Clear();

        var sessions = await calendar
            .ShapeSessionsAsync(engine, [localDate], cancellationToken)
            .ConfigureAwait(false);
        var session = sessions.Count > 0 ? sessions[0] : null;
        _sessionCache[key] = session;
        return session;
    }

    private static DateTimeOffset ToLocal(DateTimeOffset utc, string tz)
    {
        if (string.Equals(tz, "Europe/Moscow", StringComparison.OrdinalIgnoreCase)
            || string.Equals(tz, "MSK", StringComparison.OrdinalIgnoreCase))
        {
            return utc.ToOffset(MoexSchedule.MoscowOffset);
        }

        try
        {
            var zone = TimeZoneInfo.FindSystemTimeZoneById(tz);
            var local = TimeZoneInfo.ConvertTime(utc, zone);
            return local;
        }
        catch (TimeZoneNotFoundException)
        {
            return utc.ToOffset(MoexSchedule.MoscowOffset);
        }
    }
}
