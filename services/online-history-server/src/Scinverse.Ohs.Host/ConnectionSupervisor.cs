using System.Collections.Concurrent;
using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Contracts;
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
    IIncidentStore incidentStore,
    IIncidentFanOut fanOut,
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
    /// <summary>Уже отправили WARN <c>restore_declined</c> по corr (после рестарта Host — заново).</summary>
    private readonly ConcurrentDictionary<string, byte> _restoreDeclinedEmitted = new();
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

        // Сразу при старте (до client-recovery барьера): open recovering/active вне окна → WARN + journal active.
        // Иначе после рестарта Host тишина до 25с+, а Append без Hub.Adopt всё равно no-op.
        try
        {
            await HealOutOfWindowOpenBreaksAsync(time.GetUtcNow(), cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "ConnectionSupervisor: startup heal out-of-window failed");
        }

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
        var now = time.GetUtcNow();
        var states = await schedule.ListAutoEnabledAsync(cancellationToken).ConfigureAwait(false);
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

        // Даже при Auto off: open break вне окна → WARN + journal active (не отмалчиваться).
        try
        {
            await HealOutOfWindowOpenBreaksAsync(now, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "ConnectionSupervisor: heal out-of-window failed");
        }
    }

    /// <summary>
    /// После TRANSAQ→supervisor handover: войти в open-инцидент в любом случае.
    /// Вне окна — WARN + journal <c>active</c>; Auto off в окне — journal <c>active</c>;
    /// Auto on в окне — обычный nudge на reconnect.
    /// </summary>
    public async Task ReviewHandoverAsync(long connectionId, CancellationToken cancellationToken)
    {
        Nudge();
        var now = time.GetUtcNow();
        ConnectionScheduleState state;
        try
        {
            state = await schedule.GetStateAsync(connectionId, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(
                ex,
                "ConnectionSupervisor: ReviewHandover GetState failed for {ConnectionId}",
                connectionId);
            return;
        }

        var desired = await IsConnectDesiredAsync(state, now, cancellationToken).ConfigureAwait(false);
        if (!desired)
        {
            await DeclineRestoreOutOfWindowAsync(connectionId, now, cancellationToken)
                .ConfigureAwait(false);
            return;
        }

        if (!state.Settings.AutoEnabled)
        {
            // В окне, но Auto выключен — reconnect не будет; recovering → active.
            await MarkAwaitOperatorAsync(
                    connectionId,
                    now,
                    code: "connection.await_operator",
                    message: "Auto выключен — восстановление связи не выполняется",
                    severity: "warning",
                    reason: "auto_off",
                    requireRecovering: true,
                    cancellationToken: cancellationToken)
                .ConfigureAwait(false);
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

        // I10/I13: после рестарта память Hub/Manager пуста — open break берём из journal (не NC).
        await TryAdoptOpenBreakFromJournalAsync(connectionId, cancellationToken).ConfigureAwait(false);

        // Live уже есть, а NC break ещё ACTIVE (гонка Open/close) — добить recovered.
        await connections
            .EnsureBreakClosedIfLiveAsync(connectionId, nowUtc, cancellationToken)
            .ConfigureAwait(false);

        if (!desiredConnected)
        {
            _failCounts.TryRemove(connectionId, out _);
            _nextAttemptAt.TryRemove(connectionId, out _);
            // P4: Auto disconnect ≠ resolve. Break/crash remain open until recovered / manual.
            if (isConnected)
            {
                await connections.DisconnectAsync(connectionId, cancellationToken, LinkCloseReason.Scheduled)
                    .ConfigureAwait(false);
                var label = await connections.ResolveLabelAsync(connectionId, cancellationToken)
                    .ConfigureAwait(false);
                notifications.Publish(
                    "connection.schedule_disconnect",
                    $"{label}: плановое отключение по расписанию",
                    "info",
                    data: new { connectionId, sender = "supervisor" });

                logger.LogInformation(
                    "ConnectionSupervisor: disconnect {ConnectionId} (out of schedule window; incident left open)",
                    connectionId);
            }

            // Вне окна не ретраим: WARN в нить + journal recovering → active.
            await DeclineRestoreOutOfWindowAsync(connectionId, nowUtc, cancellationToken)
                .ConfigureAwait(false);
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
        var linkSubject = ConnectionManager.LinkIncidentSubject(connectionId);
        var incidentOpen = connections.GetIncidentSince(connectionId) is not null;
        if (fails >= MaxConnectAttempts)
        {
            // Journal мог остаться recovering после ×N — синхронизируем с NC (active, ждём оператора).
            if (incidentOpen)
            {
                await fanOut
                    .ApplyAsync(
                        new IncidentStep(
                            IncidentStepKind.AwaitOperator,
                            linkSubject,
                            nowUtc,
                            CorrUid: connections.GetOpenBreakCorr(connectionId),
                            ConnectionId: connectionId),
                        cancellationToken)
                    .ConfigureAwait(false);
            }

            return;
        }

        var scheduleLabel = await connections.ResolveLabelAsync(connectionId, cancellationToken)
            .ConfigureAwait(false);
        // I11: источник правды — только Manager open break (не fails>0).
        // auto: Group — только после успешного kickoff (не throwaway на fail).

        if (incidentOpen)
        {
            await fanOut
                .ApplyAsync(
                    new IncidentStep(
                        IncidentStepKind.Recovering,
                        linkSubject,
                        nowUtc,
                        ConnectionId: connectionId,
                        NcCode: "connection.reconnecting",
                        NcMessage: $"{scheduleLabel}: восстановление связи, попытка {fails + 1}/{MaxConnectAttempts}",
                        NcSeverity: "warning",
                        NcData: new
                        {
                            connectionId,
                            owner = "supervisor",
                            sender = "supervisor",
                            attempt = fails + 1,
                        }),
                    cancellationToken)
                .ConfigureAwait(false);
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
            var connect = await connections.ConnectAsync(connectionId, cancellationToken).ConfigureAwait(false);
            _failCounts.TryRemove(connectionId, out _);
            _nextAttemptAt.TryRemove(connectionId, out _);
            // Успех без open break → короткая Group auto: (connecting→connected) + Single INFO.
            // ts = ConnectResult.ReadyAt (= link_liveness.from), не UtcNow Publish.
            // Не сюда: recovered инцидента связи (ConnectAsync → CloseBreak в link:) — incidentOpen=true.
            if (!incidentOpen && connectedData is not null)
            {
                _kickoffPending.TryRemove(connectionId, out _);
                var corr = $"connection:{connectionId}:auto:{Guid.NewGuid().ToString("N")[..8]}";
                var readyAt = connect.ReadyAt;
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
                    },
                    ts: readyAt);
                notifications.Publish(
                    "connection.connected",
                    $"{scheduleLabel}: связь установлена (Auto)",
                    severity: "ok",
                    status: "resolved",
                    correlationId: corr,
                    data: NotificationThreadData.WithHints(
                        connectedData, threadKindHint: NotificationThreadData.KindGroup),
                    ts: readyAt);
                // Следом за Group — как «плановое отключение…» при schedule disconnect.
                notifications.Publish(
                    "connection.schedule_connect",
                    $"{scheduleLabel}: плановое подключение по расписанию",
                    "info",
                    data: new { connectionId, sender = "supervisor" },
                    ts: readyAt);
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
            // Финальный ×5: status=active (Auto стоп, ждём оператора) — не underway/RECOVERING.
            notifications.Append(
                linkSubject,
                "connection.connect_failed",
                failMessage,
                severity: "error",
                data: failData,
                status: nextFails >= MaxConnectAttempts ? "active" : null);

            // Single WARN вне link: — Auto стоп, нужен оператор (не засоряет break-corr).
            if (nextFails == MaxConnectAttempts)
            {
                notifications.Publish(
                    "connection.auto_stopped",
                    $"{scheduleLabel}: Auto остановлен после {MaxConnectAttempts} попыток — требуется подключение оператором",
                    severity: "warning",
                    data: new
                    {
                        connectionId,
                        attempts = nextFails,
                        sender = "supervisor",
                        reason = "max_connect_attempts",
                    });

                // Journal recovering → active (тот же смысл, что NC threadStatus Active).
                await fanOut
                    .ApplyAsync(
                        new IncidentStep(
                            IncidentStepKind.AwaitOperator,
                            linkSubject,
                            nowUtc,
                            CorrUid: connections.GetOpenBreakCorr(connectionId),
                            ConnectionId: connectionId),
                        cancellationToken)
                    .ConfigureAwait(false);
            }
        }
    }

    /// <summary>Auto исчерпал ×N для connection (in-memory; после рестарта Host — false).</summary>
    public bool IsAutoConnectExhausted(long connectionId) =>
        _failCounts.GetValueOrDefault(connectionId) >= MaxConnectAttempts;

    /// <summary>
    /// Оператор закрыл break во время recovering — стоп retry (как после ×N), без ожидания fail-счётчика.
    /// Persist Auto off — на вызывающей стороне (schedule settings).
    /// </summary>
    public void HaltAutoRecovery(long connectionId)
    {
        _failCounts[connectionId] = MaxConnectAttempts;
        _nextAttemptAt.TryRemove(connectionId, out _);
        _kickoffPending.TryRemove(connectionId, out _);
    }

    /// <summary>
    /// Нужно действие оператора: Auto ×N исчерпан, break open, окно desired, связь не поднята.
    /// Для клиента после <c>backend.recovered</c> (сон ПК / outage без рестарта Host).
    /// </summary>
    public async Task<IReadOnlyList<ConnectionNeedsOperatorDto>> ListNeedsOperatorAsync(
        CancellationToken cancellationToken)
    {
        var states = await schedule.ListAutoEnabledAsync(cancellationToken).ConfigureAwait(false);
        if (states.Count == 0)
        {
            return [];
        }

        var nowUtc = time.GetUtcNow();
        var result = new List<ConnectionNeedsOperatorDto>();
        foreach (var state in states)
        {
            var connectionId = state.Settings.ConnectionId;
            if (!IsAutoConnectExhausted(connectionId))
            {
                continue;
            }

            if (connections.GetIncidentSince(connectionId) is null)
            {
                continue;
            }

            if (IsConnected(connectionId))
            {
                continue;
            }

            if (!await IsDesiredAsync(state, nowUtc, cancellationToken).ConfigureAwait(false))
            {
                continue;
            }

            var label = await connections.ResolveLabelAsync(connectionId, cancellationToken)
                .ConfigureAwait(false);
            result.Add(new ConnectionNeedsOperatorDto(
                connectionId,
                label,
                "auto_exhausted",
                MaxConnectAttempts));
        }

        return result;
    }

    private async Task<bool> IsDesiredAsync(
        ConnectionScheduleState state, DateTimeOffset nowUtc, CancellationToken cancellationToken)
    {
        var settings = state.Settings;
        var local = ToLocal(nowUtc, settings.Tz);
        var localTime = TimeOnly.FromDateTime(local.DateTime);
        var localDate = DateOnly.FromDateTime(local.DateTime);
        var tradingByDay = new Dictionary<DateOnly, bool>();
        foreach (var openDay in new[] { localDate.AddDays(-1), localDate })
        {
            var session = await ResolveSessionAsync(settings.Engine, openDay, nowUtc, cancellationToken)
                .ConfigureAwait(false);
            tradingByDay[openDay] = session is not null;
        }

        return ConnectionScheduleResolver.IsConnectDesired(
            state.LiveRules,
            settings.Engine,
            localDate,
            localTime,
            (_, day) => tradingByDay.GetValueOrDefault(day));
    }

    /// <summary>
    /// I10/I13: если в памяти нет open break — найти в journal и засеять Manager + Hub session
    /// (тот же <c>connection:{id}:link:{uid}</c>). Без новой Open-строки. Crash не трогаем.
    /// </summary>
    private async Task TryAdoptOpenBreakFromJournalAsync(long connectionId, CancellationToken cancellationToken)
    {
        if (connections.GetIncidentSince(connectionId) is not null)
        {
            return;
        }

        Incident? row;
        try
        {
            row = await incidentStore
                .FindOpenBreakAsync(connectionId, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(
                ex,
                "ConnectionSupervisor: не удалось прочитать open break из journal для {ConnectionId}",
                connectionId);
            return;
        }

        if (row is null)
        {
            return;
        }

        var open = OpenLinkIncident.FromJournal(row);
        var subject = ConnectionManager.LinkIncidentSubject(connectionId);
        var linkState = connections.GetLinkState(connectionId);

        // Матрица после рестарта (I10 regress 2026-07-31):
        //   Live              → stale-close (journal open устарел, связь уже up)
        //   null|Degraded|Down|Error → Adopt mid-break (тот же corr; ×5 без второго break)
        if (IsStaleOpenBreak(linkState))
        {
            await ResolveStaleOpenBreakAsync(connectionId, subject, open, cancellationToken)
                .ConfigureAwait(false);
            return;
        }

        // I13: Manager = SoT runtime; Hub.Adopt — session для Progress/Append (отказ NC не блокирует).
        if (!connections.AdoptOpenIncident(
                connectionId, open.OpenedAt, owner: row.Owner ?? "supervisor", corrUid: open.CorrelationId))
        {
            logger.LogWarning(
                "ConnectionSupervisor: Manager.Adopt отказал для {Subject} corr={Corr}",
                subject, open.CorrelationId);
            return;
        }

        if (!notifications.Adopt(subject, open.CorrelationId, open.Status))
        {
            logger.LogWarning(
                "ConnectionSupervisor: Hub.Adopt отказал для {Subject} corr={Corr} status={Status} (Manager уже seeded)",
                subject, open.CorrelationId, open.Status);
        }

        await fanOut
            .ApplyAsync(
                new IncidentStep(
                    IncidentStepKind.Adopt,
                    subject,
                    open.OpenedAt,
                    CorrUid: open.CorrelationId,
                    ConnectionId: connectionId,
                    Owner: row.Owner ?? "supervisor",
                    HubStatus: open.Status),
                cancellationToken)
            .ConfigureAwait(false);

        logger.LogInformation(
            "ConnectionSupervisor: adopted open break {Corr} (status={Status}, since={Since:o}) для {ConnectionId}",
            open.CorrelationId, open.Status, open.OpenedAt, connectionId);
    }

    /// <summary>Stale-close только при реальном Live; null после crash ≠ «не в break».</summary>
    private static bool IsStaleOpenBreak(ConnectorLinkState? linkState) =>
        linkState == ConnectorLinkState.Live;

    private async Task ResolveStaleOpenBreakAsync(
        long connectionId,
        string subject,
        OpenLinkIncident open,
        CancellationToken cancellationToken)
    {
        // Stale journal open + Live: закрываем journal (и NC если Hub.Adopt ок). Hub не гейтит SoT.
        _ = notifications.Adopt(subject, open.CorrelationId, open.Status);

        var label = ConnectionManager.ConnLabelSystem(connectionId);
        await fanOut
            .ApplyAsync(
                new IncidentStep(
                    IncidentStepKind.Resolve,
                    subject,
                    DateTimeOffset.UtcNow,
                    CorrUid: open.CorrelationId,
                    ConnectionId: connectionId,
                    CloseOutcome: NotificationThreadData.OutcomeRecovered,
                    Severity: "ok",
                    NcCode: "connection.recovered",
                    NcMessage: $"{label}: связь восстановлена",
                    NcSeverity: "ok",
                    NcData: new
                    {
                        connectionId,
                        result = "Восстановлено (stale audit close)",
                        sender = "supervisor",
                        closeOutcome = NotificationThreadData.OutcomeRecovered,
                    }),
                cancellationToken)
            .ConfigureAwait(false);
        logger.LogWarning(
            "ConnectionSupervisor: closed stale audit break {Corr} для {ConnectionId} (link=Live)",
            open.CorrelationId, connectionId);
    }

    /// <summary>
    /// Тик/старт: open break (active|recovering) вне окна → decline WARN + journal active.
    /// Работает и при Auto off (не зависит от ListAutoEnabled).
    /// </summary>
    private async Task HealOutOfWindowOpenBreaksAsync(
        DateTimeOffset nowUtc, CancellationToken cancellationToken)
    {
        // Два запроса: Query фильтрует один status.
        foreach (var status in new[] { "recovering", "active" })
        {
            var rows = await incidentStore
                .QueryAsync(
                    new IncidentQuery
                    {
                        Module = "connection",
                        Type = "break",
                        Status = status,
                        Limit = 100,
                    },
                    cancellationToken)
                .ConfigureAwait(false);

            foreach (var row in rows)
            {
                if (row.ConnectionId is not { } connectionId || row.DeletedAt is not null)
                {
                    continue;
                }

                ConnectionScheduleState state;
                try
                {
                    state = await schedule.GetStateAsync(connectionId, cancellationToken)
                        .ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogWarning(
                        ex,
                        "ConnectionSupervisor: heal GetState failed for {ConnectionId}",
                        connectionId);
                    continue;
                }

                if (await IsConnectDesiredAsync(state, nowUtc, cancellationToken).ConfigureAwait(false))
                {
                    continue;
                }

                await DeclineRestoreOutOfWindowAsync(connectionId, nowUtc, cancellationToken)
                    .ConfigureAwait(false);
            }
        }
    }

    /// <summary>
    /// Вне окна: WARN в open-нить + journal <c>recovering → active</c>.
    /// </summary>
    private Task DeclineRestoreOutOfWindowAsync(
        long connectionId, DateTimeOffset nowUtc, CancellationToken cancellationToken) =>
        MarkAwaitOperatorAsync(
            connectionId,
            nowUtc,
            code: "connection.restore_declined",
            message: "Супервизор отклонил восстановление связи в нерабочее окно расписания",
            severity: "warning",
            reason: "out_of_schedule",
            requireRecovering: false,
            cancellationToken: cancellationToken);

    private async Task MarkAwaitOperatorAsync(
        long connectionId,
        DateTimeOffset nowUtc,
        string code,
        string message,
        string severity,
        string reason,
        bool requireRecovering,
        CancellationToken cancellationToken)
    {
        // После рестарта Hub пуст — Append в нить no-op, пока не Adopt из journal.
        await TryAdoptOpenBreakFromJournalAsync(connectionId, cancellationToken).ConfigureAwait(false);

        var corr = connections.GetOpenBreakCorr(connectionId);
        Incident? row = !string.IsNullOrWhiteSpace(corr)
            ? await incidentStore.GetAsync(corr!, cancellationToken).ConfigureAwait(false)
            : null;

        if (row is null || row.Status is "resolved" || row.DeletedAt is not null)
        {
            row = await incidentStore.FindOpenBreakAsync(connectionId, cancellationToken)
                .ConfigureAwait(false);
        }

        if (row is null || row.DeletedAt is not null || row.Status is "resolved")
        {
            return;
        }

        var isRecovering = row.Status is "recovering";
        if (requireRecovering && !isRecovering)
        {
            return;
        }

        if (!isRecovering && row.Status is not "active")
        {
            return;
        }

        // Вне окна WARN «отклонил» — только решение супервизора (Auto/heal), не фон ручного reconnect.
        if (reason == "out_of_schedule")
        {
            if (connections.IsOperatorReconnectPending(connectionId)
                || connections.HasSession(connectionId)
                || connections.GetStatus(connectionId) is "waiting" or "active" or "degraded")
            {
                return;
            }
        }

        corr = row.CorrUid;
        var linkSubject = ConnectionManager.LinkIncidentSubject(connectionId);
        var alreadyWarned = _restoreDeclinedEmitted.ContainsKey(corr);

        // Повторный heal: WARN уже был (уместный, при отказе супервизора) — не дублируем.
        // Journal recovering после fail оператора → только sync → active, без второго WARN.
        if (reason == "out_of_schedule" && alreadyWarned)
        {
            if (!isRecovering)
            {
                return;
            }

            await fanOut
                .ApplyAsync(
                    new IncidentStep(
                        IncidentStepKind.AwaitOperator,
                        linkSubject,
                        nowUtc,
                        CorrUid: corr,
                        ConnectionId: connectionId),
                    cancellationToken)
                .ConfigureAwait(false);
            return;
        }

        var hubStatus = OpenLinkIncident.FromJournal(row).Status;
        if (!notifications.TryGetOpenCorrelationId(linkSubject, out _))
        {
            if (!notifications.Adopt(linkSubject, corr, hubStatus))
            {
                logger.LogWarning(
                    "ConnectionSupervisor: Hub.Adopt failed before {Code} for {Corr}",
                    code,
                    corr);
            }
        }

        var label = await connections.ResolveLabelAsync(connectionId, cancellationToken)
            .ConfigureAwait(false);
        var text = $"{label}: {message}";
        var data = new
        {
            connectionId,
            sender = "supervisor",
            reason,
        };

        // Append требует open в Hub; иначе Publish с тем же corr — всё равно в нить Incident.
        var appended = notifications.Append(
            linkSubject,
            code,
            text,
            severity: severity,
            data: data,
            status: "active",
            ts: nowUtc);
        if (!appended)
        {
            notifications.Publish(
                code,
                text,
                severity: severity,
                sourceType: "system",
                data: data,
                status: "active",
                correlationId: corr,
                subject: linkSubject,
                ts: nowUtc);
        }

        if (reason == "out_of_schedule")
        {
            _restoreDeclinedEmitted.TryAdd(corr, 0);
        }

        if (isRecovering)
        {
            await fanOut
                .ApplyAsync(
                    new IncidentStep(
                        IncidentStepKind.AwaitOperator,
                        linkSubject,
                        nowUtc,
                        CorrUid: corr,
                        ConnectionId: connectionId),
                    cancellationToken)
                .ConfigureAwait(false);
        }

        logger.LogInformation(
            "ConnectionSupervisor: {Code} {ConnectionId} ({Reason}; journal={Status}; appended={Appended})",
            code,
            connectionId,
            reason,
            row.Status,
            appended);
    }

    private async Task<bool> IsConnectDesiredAsync(
        ConnectionScheduleState state, DateTimeOffset nowUtc, CancellationToken cancellationToken)
    {
        var settings = state.Settings;
        var local = ToLocal(nowUtc, settings.Tz);
        var localTime = TimeOnly.FromDateTime(local.DateTime);
        var localDate = DateOnly.FromDateTime(local.DateTime);
        var tradingByDay = new Dictionary<DateOnly, bool>();
        foreach (var openDay in new[] { localDate.AddDays(-1), localDate })
        {
            var session = await ResolveSessionAsync(settings.Engine, openDay, nowUtc, cancellationToken)
                .ConfigureAwait(false);
            tradingByDay[openDay] = session is not null;
        }

        return ConnectionScheduleResolver.IsConnectDesired(
            state.LiveRules,
            settings.Engine,
            localDate,
            localTime,
            (_, day) => tradingByDay.GetValueOrDefault(day));
    }

    /// <summary>
    /// Backup handover (J3): прогресс TRANSAQ t&lt;T теперь в <see cref="ConnectionManager"/> (сразу t=0).
    /// Здесь — только страховка, если Manager-таймер не успел при t≥T.
    /// </summary>
    private async Task TickRecoveringAsync(long connectionId, DateTimeOffset nowUtc, CancellationToken cancellationToken)
    {
        if (connections.GetLinkState(connectionId) != ConnectorLinkState.Degraded
            || connections.GetIncidentSince(connectionId) is not { } since)
        {
            return;
        }

        if (nowUtc - since < RecoverGrace)
        {
            return;
        }

        var label = await connections.ResolveLabelAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var graceSec = (int)RecoverGrace.TotalSeconds;
        var subject = ConnectionManager.LinkIncidentSubject(connectionId);
        await fanOut
            .ApplyAsync(
                new IncidentStep(
                    IncidentStepKind.Recovering,
                    subject,
                    nowUtc,
                    ConnectionId: connectionId,
                    NcCode: "connection.reconnecting",
                    NcMessage: $"{label}: нет восстановления связи (TRANSAQ) за {graceSec} с, передача супервизору",
                    NcSeverity: "warning",
                    NcData: new
                    {
                        connectionId,
                        owner = "supervisor",
                        sender = "supervisor",
                        handoverAfterSeconds = graceSec,
                    }),
                cancellationToken)
            .ConfigureAwait(false);
        await connections.HandoverToSupervisorAsync(connectionId, nowUtc, cancellationToken).ConfigureAwait(false);
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
