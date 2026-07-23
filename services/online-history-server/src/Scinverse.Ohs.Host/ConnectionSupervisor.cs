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
    // correlationId авто-серии (7j.18): connecting×N → connected/connect_failed сворачиваются в один
    // сеанс; создаётся на первой попытке, снимается при успехе/исчерпании/сбросе.
    private readonly ConcurrentDictionary<long, string> _autoCorr = new();
    // Дедуп сбоев тика по подключению (7j.18): сигнатура последней ошибки — чтобы не спамить NC.
    private readonly ConcurrentDictionary<long, string> _tickError = new();

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
        var states = await schedule.ListAutoEnabledAsync(cancellationToken).ConfigureAwait(false);
        if (states.Count == 0)
        {
            return;
        }

        var now = time.GetUtcNow();
        foreach (var state in states)
        {
            var connectionId = state.Settings.ConnectionId;
            try
            {
                await ReconcileOneAsync(state, now, cancellationToken).ConfigureAwait(false);
                // Успешный тик снимает дедуп: следующий сбой снова уведомит.
                _tickError.TryRemove(connectionId, out _);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(
                    ex,
                    "ConnectionSupervisor: не удалось согласовать Auto для connection {ConnectionId}",
                    connectionId);
                await PublishTickFailureAsync(connectionId, ex, cancellationToken).ConfigureAwait(false);
            }
        }
    }

    /// <summary>Сбой авто-управления связью в тике (плановый disconnect, чтение расписания, резолвер и
    /// т.п. — кроме connect-фейлов, у них своя серия) → NC (system·error) с именем. Дедуп по сигнатуре
    /// исключения: одинаковая ошибка не спамит каждые 15 c, повторно уведомляет лишь при её смене.</summary>
    private async Task PublishTickFailureAsync(long connectionId, Exception ex, CancellationToken cancellationToken)
    {
        var signature = $"{ex.GetType().FullName}: {ex.Message}";
        if (_tickError.TryGetValue(connectionId, out var previous) && previous == signature)
        {
            return;
        }

        _tickError[connectionId] = signature;

        string label;
        try
        {
            label = await connections.ResolveLabelAsync(connectionId, cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            label = ConnectionManager.ConnLabel(connectionId, null);
        }

        notifications.Publish(
            "connection.auto_error",
            $"{label}: сбой авто-управления связью — {SummarizeException(ex)}",
            severity: "error",
            sourceType: "system",
            data: new { connectionId, lines = new[] { SummarizeException(ex) } });
    }

    /// <summary>Краткая суть исключения (тип + message, усечение ≤300). Полный стек — в логе.</summary>
    private static string SummarizeException(Exception ex)
    {
        var summary = $"{ex.GetType().Name}: {ex.Message}";
        return summary.Length > 300 ? summary[..300] + "…" : summary;
    }

    private async Task ReconcileOneAsync(
        ConnectionScheduleState state, DateTimeOffset nowUtc, CancellationToken cancellationToken)
    {
        var settings = state.Settings;
        var connectionId = settings.ConnectionId;
        var local = ToLocal(nowUtc, settings.Tz);
        var localTime = TimeOnly.FromDateTime(local.DateTime);
        var localDate = DateOnly.FromDateTime(local.DateTime);

        // Кандидаты — дни открытия {вчера, сегодня}; торговый день нужен только для main-скоупа.
        var tradingByDay = new Dictionary<DateOnly, bool>();
        foreach (var openDay in new[] { localDate.AddDays(-1), localDate })
        {
            var session = await ResolveSessionAsync(settings.Engine, openDay, nowUtc, cancellationToken)
                .ConfigureAwait(false);
            tradingByDay[openDay] = session is not null;
        }

        var desiredConnected = ConnectionScheduleResolver.IsConnectDesired(
            state.LiveRules,
            settings.Engine,
            localDate,
            localTime,
            (_, day) => tradingByDay.GetValueOrDefault(day));
        var isConnected = IsConnected(connectionId);

        if (!desiredConnected)
        {
            _failCounts.TryRemove(connectionId, out _);
            _nextAttemptAt.TryRemove(connectionId, out _);
            _autoCorr.TryRemove(connectionId, out _);
            if (isConnected)
            {
                await connections.DisconnectAsync(connectionId, cancellationToken)
                    .ConfigureAwait(false);
                var label = await connections.ResolveLabelAsync(connectionId, cancellationToken)
                    .ConfigureAwait(false);
                notifications.Publish(
                    "connection.schedule_disconnect",
                    $"{label}: плановое отключение (вне окна / non-trading)",
                    "info",
                    data: new { connectionId });
                logger.LogInformation(
                    "ConnectionSupervisor: disconnect {ConnectionId} (out of schedule window)",
                    connectionId);
            }

            return;
        }

        if (isConnected)
        {
            _failCounts.TryRemove(connectionId, out _);
            _nextAttemptAt.TryRemove(connectionId, out _);
            _autoCorr.TryRemove(connectionId, out _);
            return;
        }

        if (_nextAttemptAt.TryGetValue(connectionId, out var next) && nowUtc < next)
        {
            return;
        }

        var fails = _failCounts.GetValueOrDefault(connectionId);
        if (fails >= MaxConnectAttempts)
        {
            return;
        }

        var scheduleLabel = await connections.ResolveLabelAsync(connectionId, cancellationToken)
            .ConfigureAwait(false);
        // correlationId авто-серии: один сеанс connecting×N → connected/failed сворачивается в ленте.
        var corr = _autoCorr.GetOrAdd(
            connectionId, id => $"connection:{id}:auto:{Guid.NewGuid().ToString("N")[..8]}");

        notifications.Publish(
            "connection.connecting",
            $"{scheduleLabel}: подключаю по расписанию, попытка {fails + 1}/{MaxConnectAttempts}",
            severity: "warning",
            status: "underway",
            correlationId: corr,
            data: new { connectionId, attempt = fails + 1 });

        // Если по этому подключению открыт инцидент связи (lost, active) — переводим его в underway.
        // severity=warning: underway остаётся «жёлтым, ещё не решено» (маска фона в ленте).
        notifications.Progress(
            ConnectionManager.LinkIncidentSubject(connectionId),
            "connection.reconnecting",
            $"{scheduleLabel}: восстановление связи, попытка {fails + 1}/{MaxConnectAttempts}",
            severity: "warning",
            data: new { connectionId, attempt = fails + 1 });

        try
        {
            await connections.ConnectAsync(connectionId, cancellationToken).ConfigureAwait(false);
            _failCounts.TryRemove(connectionId, out _);
            _nextAttemptAt.TryRemove(connectionId, out _);
            _autoCorr.TryRemove(connectionId, out _);
            notifications.Publish(
                "connection.connected",
                $"{scheduleLabel}: связь установлена",
                severity: "ok",
                status: "resolved",
                correlationId: corr,
                data: new { connectionId });
            logger.LogInformation(
                "ConnectionSupervisor: connect OK {ConnectionId}", connectionId);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            var nextFails = _failCounts.AddOrUpdate(connectionId, 1, (_, n) => n + 1);
            _nextAttemptAt[connectionId] = nowUtc + RetryPause;
            logger.LogWarning(
                ex,
                "ConnectionSupervisor: connect fail {ConnectionId} ({Attempt}/{Max})",
                connectionId, nextFails, MaxConnectAttempts);

            if (nextFails >= MaxConnectAttempts)
            {
                _autoCorr.TryRemove(connectionId, out _);
                notifications.Publish(
                    "connection.connect_failed",
                    $"{scheduleLabel}: не удалось подключить за {MaxConnectAttempts} попыток",
                    severity: "error",
                    correlationId: corr,
                    data: new { connectionId, attempts = nextFails });
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
