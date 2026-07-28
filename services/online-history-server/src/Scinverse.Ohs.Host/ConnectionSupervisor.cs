using System.Collections.Concurrent;
using Scinverse.Ohs.Connectors.Transaq;
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
    INotificationStore notificationStore,
    ClientRecoveryGate recoveryGate,
    ILogger<ConnectionSupervisor> logger)
{
    private static readonly TimeSpan RetryPause = TimeSpan.FromSeconds(8);
    private const int MaxConnectAttempts = 5;

    /// <summary>Дедлайн передачи владения TRANSAQ→супервизор (7j.20 J3/J8), дефолт 60 c.</summary>
    private TimeSpan RecoverGrace => TimeSpan.FromSeconds(
        options.LinkRecoverGraceSeconds > 0 ? options.LinkRecoverGraceSeconds : 60);

    /// <summary>Connect-grace барьера восстановления клиента (7j.20); ≤0 — барьер выключен.</summary>
    private TimeSpan ClientRecoveryGrace => TimeSpan.FromSeconds(options.ClientRecoveryGraceSeconds);

    /// <summary>Heads-up-grace барьера: ждать hold после подключения клиента (7j.20), дефолт 8 c.</summary>
    private TimeSpan ClientRecoveryHeadsUp => TimeSpan.FromSeconds(
        options.ClientRecoveryHeadsUpSeconds > 0 ? options.ClientRecoveryHeadsUpSeconds : 8);

    /// <summary>Hold-grace барьера: ждать recover после heads-up (7j.20), дефолт 90 c.</summary>
    private TimeSpan ClientRecoveryHoldMax => TimeSpan.FromSeconds(
        options.ClientRecoveryHoldMaxSeconds > 0 ? options.ClientRecoveryHoldMaxSeconds : 90);

    private readonly SemaphoreSlim _wake = new(0, 1);
    private readonly ConcurrentDictionary<long, int> _failCounts = new();
    private readonly ConcurrentDictionary<long, DateTimeOffset> _nextAttemptAt = new();
    // Дедуп сбоев тика по подключению (7j.18): сигнатура последней ошибки — чтобы не спамить NC.
    private readonly ConcurrentDictionary<long, string> _tickError = new();
    // 7j.20: детект «плановый старт окна» (kickoff). _prevDesired — предыдущее IsConnectDesired на тике;
    // переход false→true ⇒ расписание только что открыло окно ⇒ _kickoffPending=true (держим до успешного
    // коннекта, чтобы вся серия попыток на открытии считалась плановой). Отличает «Auto подключение по
    // расписанию» от «Auto подключение внутри интервала расписания» (реконнект внутри уже открытого окна:
    // дроп/ручное/рестарт бэка). Состояние in-memory: рестарт внутри открытого окна перехода не видел →
    // такой подъём честно классифицируется как «внутри интервала».
    private readonly ConcurrentDictionary<long, bool> _prevDesired = new();
    private readonly ConcurrentDictionary<long, bool> _kickoffPending = new();

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

        // 7j.20: барьер восстановления клиента. Перед ПЕРВЫМ Auto-реконнектом ждём: клиент, ведущий инцидент
        // простоя, шлёт heads-up (hold) на реконнекте и backend.recovered при закрытии — тогда «Система
        // восстановлена» встаёт в NC ДО connection.connecting/connected, и Auto не идёт, пока инцидент
        // открыт. Нет heads-up за initial ⇒ клиента/инцидента нет ⇒ стартуем. Один раз, на старте процесса.
        var recoveryGrace = ClientRecoveryGrace;
        if (recoveryGrace > TimeSpan.Zero)
        {
            try
            {
                var reason = await recoveryGate
                    .WaitAsync(recoveryGrace, ClientRecoveryHeadsUp, ClientRecoveryHoldMax, cancellationToken)
                    .ConfigureAwait(false);
                logger.LogInformation("ConnectionSupervisor: барьер восстановления клиента снят ({Reason})", reason);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }

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

        var data = new
        {
            connectionId,
            error_message = SummarizeException(ex),
            sender = "supervisor",
        };
        // Внутри открытого break — та же corr-нить; иначе одиночный system-error.
        if (connections.GetIncidentSince(connectionId) is not null)
        {
            notifications.Append(
                ConnectionManager.LinkIncidentSubject(connectionId),
                "connection.auto_error",
                $"{label}: сбой auto-управления связью",
                severity: "error",
                data: data);
        }
        else
        {
            notifications.Publish(
                "connection.auto_error",
                $"{label}: сбой auto-управления связью",
                severity: "error",
                sourceType: "system",
                data: data);
        }
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

        // Kickoff-детект: расписание открыло окно (desired false→true) ⇒ ближайший подъём — плановый старт.
        // Первый тик после старта процесса перехода не видит (prev отсутствует) ⇒ kickoff не выставляется.
        var hadPrev = _prevDesired.TryGetValue(connectionId, out var prevDesired);
        if (desiredConnected && hadPrev && !prevDesired)
        {
            _kickoffPending[connectionId] = true;
        }
        else if (!desiredConnected)
        {
            _kickoffPending.TryRemove(connectionId, out _);
        }

        _prevDesired[connectionId] = desiredConnected;

        // I10: после crash/рестарта память Hub/Manager пуста, а в V025 может висеть open link-corr.
        // Подхватить до ветки desired — иначе !desired не сделает catch-up abandon, а desired счеканит auto:.
        await TryAdoptOpenBreakFromAuditAsync(connectionId, cancellationToken).ConfigureAwait(false);

        if (!desiredConnected)
        {
            _failCounts.TryRemove(connectionId, out _);
            _nextAttemptAt.TryRemove(connectionId, out _);
            // Открытый break → closing-warn в том же corr + клип ленты (Abandoned); иначе обычный info.
            var abandoned = await connections
                .TryAbandonIncidentByScheduleAsync(connectionId, nowUtc, cancellationToken)
                .ConfigureAwait(false);
            if (isConnected)
            {
                await connections.DisconnectAsync(connectionId, cancellationToken, LinkCloseReason.Scheduled)
                    .ConfigureAwait(false);
                if (!abandoned)
                {
                    var label = await connections.ResolveLabelAsync(connectionId, cancellationToken)
                        .ConfigureAwait(false);
                    notifications.Publish(
                        "connection.schedule_disconnect",
                        $"{label}: плановое отключение по расписанию",
                        "info",
                        data: new { connectionId });
                }

                logger.LogInformation(
                    "ConnectionSupervisor: disconnect {ConnectionId} (out of schedule window{Abandoned})",
                    connectionId, abandoned ? ", break abandoned" : "");
            }

            return;
        }

        if (isConnected)
        {
            _failCounts.TryRemove(connectionId, out _);
            _nextAttemptAt.TryRemove(connectionId, out _);
            await TickRecoveringAsync(connectionId, nowUtc, cancellationToken).ConfigureAwait(false);
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
        // I11: источник правды — только Manager open break (не fails>0).
        // auto: Group — только после успешного kickoff (не throwaway на fail).
        var incidentOpen = connections.GetIncidentSince(connectionId) is not null;
        var linkSubject = ConnectionManager.LinkIncidentSubject(connectionId);

        if (incidentOpen)
        {
            notifications.Progress(
                linkSubject,
                "connection.reconnecting",
                $"{scheduleLabel}: восстановление связи, попытка {fails + 1}/{MaxConnectAttempts}",
                severity: "warning",
                data: new
                {
                    connectionId,
                    owner = "supervisor",
                    sender = "supervisor",
                    attempt = fails + 1,
                });
        }

        // «Предыдущее подключение» — до нового Heartbeat. При инциденте детали идут в recovered, не сюда.
        object? connectedData = null;
        if (!incidentOpen)
        {
            var kickoff = _kickoffPending.ContainsKey(connectionId);
            var autoNote = kickoff
                ? "Auto подключение по расписанию"
                : "Auto подключение внутри интервала расписания";
            connectedData = await connections
                .FormatConnectedNotifyDataAsync(connectionId, "supervisor", cancellationToken, autoNote)
                .ConfigureAwait(false);
        }

        try
        {
            await connections.ConnectAsync(connectionId, cancellationToken).ConfigureAwait(false);
            _failCounts.TryRemove(connectionId, out _);
            _nextAttemptAt.TryRemove(connectionId, out _);
            // Успешный kickoff без break → короткая Group auto: (connecting→connected), не до fail.
            if (!incidentOpen && connectedData is not null)
            {
                _kickoffPending.TryRemove(connectionId, out _);
                var corr = $"connection:{connectionId}:auto:{Guid.NewGuid().ToString("N")[..8]}";
                notifications.Publish(
                    "connection.connecting",
                    $"{scheduleLabel}: подключаю по расписанию…",
                    severity: "warning",
                    status: "underway",
                    correlationId: corr,
                    data: new
                    {
                        connectionId,
                        sender = "supervisor",
                        threadKindHint = NotificationThreadData.KindGroup,
                    });
                notifications.Publish(
                    "connection.connected",
                    $"{scheduleLabel}: связь установлена (Auto)",
                    severity: "ok",
                    status: "resolved",
                    correlationId: corr,
                    data: NotificationThreadData.WithHints(
                        connectedData, threadKindHint: NotificationThreadData.KindGroup));
            }

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

            // Fail → link: Incident (без auto: Group). Дальше ×N только Progress/Append в link:.
            connections.EnsureBreakIncidentOnConnectFailure(connectionId, nowUtc, scheduleLabel);

            var failData = new
            {
                connectionId,
                attempts = nextFails,
                state = "Error",
                error_message = ConnectionManager.ExtractTransaqErrorMessage(ex.Message),
                sender = "supervisor",
            };
            var failMessage = nextFails >= MaxConnectAttempts
                ? $"{scheduleLabel}: не удалось подключить за {MaxConnectAttempts} попыток"
                : $"{scheduleLabel}: не удалось подключиться (попытка {nextFails}/{MaxConnectAttempts})";
            notifications.Append(
                linkSubject,
                "connection.connect_failed",
                failMessage,
                severity: "error",
                data: failData);
        }
    }

    /// <summary>
    /// I10: если в памяти нет open break — найти в аудите V025 и засеять Manager + Hub
    /// (тот же <c>connection:{id}:link:{uid}</c>). Без новой Open-строки. Crash-corr не трогаем.
    /// </summary>
    private async Task TryAdoptOpenBreakFromAuditAsync(long connectionId, CancellationToken cancellationToken)
    {
        if (connections.GetIncidentSince(connectionId) is not null)
        {
            return;
        }

        OpenLinkIncident? open;
        try
        {
            open = await notificationStore
                .FindOpenLinkIncidentAsync(connectionId, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(
                ex,
                "ConnectionSupervisor: не удалось прочитать open break из аудита для {ConnectionId}",
                connectionId);
            return;
        }

        if (open is null)
        {
            return;
        }

        // I11 B2: Hub — ворота Progress/Append. Сначала Hub, потом Manager;
        // отказ Manager → Forget Hub (без Resolve-события). Отказ Hub → ничего не сеем.
        var subject = ConnectionManager.LinkIncidentSubject(connectionId);
        if (!notifications.Adopt(subject, open.CorrelationId, open.Status))
        {
            logger.LogWarning(
                "ConnectionSupervisor: Hub.Adopt отказал для {Subject} corr={Corr} status={Status}",
                subject, open.CorrelationId, open.Status);
            return;
        }

        if (!connections.AdoptOpenIncident(connectionId, open.OpenedAt, owner: "supervisor"))
        {
            notifications.Forget(subject, open.CorrelationId);
            logger.LogWarning(
                "ConnectionSupervisor: Manager.Adopt отказал после Hub — откат Hub для {Subject} corr={Corr}",
                subject, open.CorrelationId);
            return;
        }

        logger.LogInformation(
            "ConnectionSupervisor: adopted open break {Corr} (status={Status}, since={Since:o}) для {ConnectionId}",
            open.CorrelationId, open.Status, open.OpenedAt, connectionId);
    }

    /// <summary>Прогресс-тик восстановления средствами TRANSAQ (7j.20 J5). Пока связь в <c>Degraded</c>
    /// и инцидент открыт — тик супервизора шлёт underway «восстановление (TRANSAQ) · N с» (кратность 5 с)
    /// с <c>sender=supervisor</c>, <c>owner=transaq</c>. По grace <c>t</c> — handover (J3/J6).</summary>
    private async Task TickRecoveringAsync(long connectionId, DateTimeOffset nowUtc, CancellationToken cancellationToken)
    {
        if (connections.GetLinkState(connectionId) != ConnectorLinkState.Degraded
            || connections.GetIncidentSince(connectionId) is not { } since)
        {
            return;
        }

        var elapsed = nowUtc - since;
        var label = await connections.ResolveLabelAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var graceSec = (int)RecoverGrace.TotalSeconds;

        if (elapsed >= RecoverGrace)
        {
            notifications.Progress(
                ConnectionManager.LinkIncidentSubject(connectionId),
                "connection.reconnecting",
                $"{label}: нет восстановления связи (TRANSAQ) за {graceSec} с, передача супервизору",
                severity: "warning",
                data: new
                {
                    connectionId,
                    owner = "supervisor",
                    sender = "supervisor",
                    handoverAfterSeconds = graceSec,
                });
            await connections.HandoverToSupervisorAsync(connectionId, nowUtc, cancellationToken).ConfigureAwait(false);
            return;
        }

        // Кратно 5 с: 5/55, 10/50… не 7/53 (тик ~5 с + floor elapsed).
        const int stepSec = 5;
        var elapsedSec = Math.Max(0, ((int)elapsed.TotalSeconds / stepSec) * stepSec);
        var remainingSec = Math.Max(0, graceSec - elapsedSec);
        notifications.Progress(
            ConnectionManager.LinkIncidentSubject(connectionId),
            "connection.recovering",
            $"{label}: восстановление связи (TRANSAQ) · {elapsedSec} с, передача супервизору через {remainingSec} с",
            severity: "warning",
            data: new
            {
                connectionId,
                owner = "transaq",
                sender = "supervisor",
                elapsedSeconds = elapsedSec,
                handoverInSeconds = remainingSec,
            });
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
