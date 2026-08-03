using System.Collections.Concurrent;
using System.Text.Json;
using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>Снимок живого подключения для опроса живости (phase 7h.2).</summary>
public sealed record LiveConnectionSnapshot(long ConnectionId, short SourceId, IMarketConnector Connector);

/// <summary>
/// Итог <see cref="ConnectionManager.ConnectAsync"/>: статус UI + <see cref="ReadyAt"/> —
/// общий <c>ts</c> для <c>link_liveness</c> и NC <c>connection.connected</c>.
/// </summary>
public readonly record struct ConnectResult(string Status, DateTimeOffset ReadyAt);

/// <summary>
/// Управляет живыми подключениями (сессиями коннекторов) по connector_connection:
/// connect/disconnect/test/status. Секреты берёт из in-memory <see cref="ICredentialStore"/>.
/// </summary>
public sealed class ConnectionManager(
    IConnectionStore connectionStore,
    IConnectorFactory factory,
    ICredentialStore credentials,
    ITransaqParser parser,
    IInstrumentRegistry registry,
    ISourceStore sourceStore,
    TradeNormalizer normalizer,
    TradeBatcher batcher,
    CoverageTracker coverageTracker,
    WebSocketBroadcaster broadcaster,
    Lazy<ILivenessWriter> liveness,
    Lazy<RecordingManager> recordings,
    ILinkLivenessStore linkLiveness,
    IIncidentStore incidentStore,
    INotificationPublisher notifications,
    IIncidentFanOut fanOut,
    TransaqConnectorOptions transaqDefaults,
    OhsOptions options,
    ILoggerFactory loggerFactory,
    ILogger<ConnectionManager> logger) : IDisposable
{
    /// <summary>subject инцидента связи (общий с ConnectionSupervisor). Хаб присвоит per-occurrence
    /// correlationId = subject:uid; поиск по этому префиксу собирает все инциденты связи подключения.</summary>
    public static string LinkIncidentSubject(long connectionId) => $"connection:{connectionId}:link";

    /// <summary>Порог тишины: нет данных от коннектора дольше — статус «ожидание» (waiting).</summary>
    private static readonly TimeSpan _idleThreshold = TimeSpan.FromSeconds(5);

    /// <summary>Макс. разрыв keepalive связи: больше — интервал считается прерванным (краш процесса).</summary>
    internal static readonly TimeSpan LinkMaxGap = TimeSpan.FromSeconds(45);

    /// <summary>T — окно владения TRANSAQ (жёлтое на ленте), затем handover супервизору.</summary>
    private TimeSpan RecoverGrace => TimeSpan.FromSeconds(
        options.LinkRecoverGraceSeconds > 0 ? options.LinkRecoverGraceSeconds : 60);

    /// <summary>Debounce Degraded→open: короткие recover-flap TRANSAQ не плодят green-маркеры.</summary>
    private TimeSpan DegradedConfirmDelay => TimeSpan.FromSeconds(
        Math.Max(0, options.LinkDegradedConfirmSeconds));

    private readonly ConcurrentDictionary<long, ConnectorSession> _sessions = new();
    private readonly ConcurrentDictionary<long, short> _sourceIds = new();
    private readonly ConcurrentDictionary<long, string> _status = new();
    private readonly ConcurrentDictionary<long, DateTimeOffset> _lastData = new();
    // Момент установки связи — чтобы залогировать задержку до ПЕРВОЙ сделки (диагностика «долго до данных»).
    private readonly ConcurrentDictionary<long, DateTimeOffset> _firstTradePending = new();
    private readonly ConcurrentDictionary<long, ConnectorLinkState> _linkStates = new();
    private readonly ConcurrentDictionary<long, DateTimeOffset> _linkSince = new();
    // Начало открытого инцидента связи (для длительности разрыва в recovered, 7j.19/I2+I3). ПЕРЕЖИВАЕТ
    // передисконнект реконнекта (в отличие от _linkStates) — иначе recovered/длительность теряются.
    private readonly ConcurrentDictionary<long, DateTimeOffset> _incidentSince = new();
    // Владелец восстановления открытого инцидента (7j.20): "transaq" (сам поднял в Degraded до handover)
    // либо "supervisor" (Down/Error/ping-fail сразу, либо передача владения по grace). Нужен для expanded
    // recovered («кем восстановлена связь»). Живёт вместе с _incidentSince (ставится на open, снимается на recovered).
    private readonly ConcurrentDictionary<long, string> _incidentOwner = new();
    // I13: corr открытого break (journal SoT); Hub session зеркалит, не владеет.
    private readonly ConcurrentDictionary<long, string> _incidentCorr = new();
    /// <summary>Ожидание confirm Degraded (flap &lt; delay → cancel, без journal/green).</summary>
    private readonly ConcurrentDictionary<long, CancellationTokenSource> _degradedConfirm = new();
    private readonly ConcurrentDictionary<long, (DateTimeOffset At, string? Detail)> _degradedPending = new();
    /// <summary>J5: прогресс TRANSAQ (t&lt;T) + handover по T — в Manager, не ждём тик Auto-супервизора.</summary>
    private readonly ConcurrentDictionary<long, CancellationTokenSource> _transaqProgress = new();
    /// <summary>Ручной connect при open break — heal не должен писать «супервизор отклонил».</summary>
    private readonly ConcurrentDictionary<long, byte> _operatorReconnect = new();
    /// <summary>
    /// Только что закрытый break (corr+outcome): пока journal/Hub догоняют — orphan/stale
    /// не должны Adopt+Resolve вторым <c>recovered</c> и затирать <c>recovered_manual</c>.
    /// </summary>
    private readonly ConcurrentDictionary<long, RecentBreakClose> _recentBreakClose = new();
    private static readonly TimeSpan RecentBreakCloseTtl = TimeSpan.FromSeconds(60);
    private Timer? _idleMonitor;

    private readonly record struct RecentBreakClose(string? CorrUid, string Outcome, DateTimeOffset At);

    /// <summary>Пробудить <see cref="ConnectionSupervisor"/> после open/handover (wire в OhsWorker).</summary>
    public Action? RequestSupervisorNudge { get; set; }

    /// <summary>
    /// После TRANSAQ→supervisor handover: ревью open-инцидента (WARN вне окна / journal→active).
    /// Wire в OhsWorker → <c>ConnectionSupervisor.ReviewHandoverAsync</c>.
    /// </summary>
    public Func<long, CancellationToken, Task>? OnBreakHandedOverAsync { get; set; }

    public ConnectorLinkState? GetLinkState(long connectionId) =>
        _linkStates.TryGetValue(connectionId, out var state) ? state : null;

    /// <summary>Момент открытия текущего инцидента связи (левая граница дыры) или null, если связь в порядке.
    /// Питает прогресс-тик восстановления (7j.20 J5): elapsed = now − since.</summary>
    public DateTimeOffset? GetIncidentSince(long connectionId) =>
        _incidentSince.TryGetValue(connectionId, out var since) ? since : null;

    /// <summary>Corr текущего open break в Manager или null.</summary>
    public string? GetOpenBreakCorr(long connectionId) =>
        _incidentCorr.TryGetValue(connectionId, out var corr) ? corr : null;

    /// <summary>Владелец open break: <c>transaq</c> (grace T) / <c>supervisor</c> / null.</summary>
    public string? GetIncidentOwner(long connectionId) =>
        _incidentOwner.TryGetValue(connectionId, out var owner) ? owner : null;

    /// <summary>
    /// Засеять открытый break в память после рестарта (I10/I13): since/owner/corr из journal.
    /// Hub seed — отдельно. false — уже был открытый инцидент в памяти.
    /// </summary>
    public bool AdoptOpenIncident(
        long connectionId,
        DateTimeOffset since,
        string owner = "supervisor",
        string? corrUid = null)
    {
        if (!_incidentSince.TryAdd(connectionId, since))
        {
            return false;
        }

        _incidentOwner[connectionId] = string.IsNullOrWhiteSpace(owner) ? "supervisor" : owner;
        if (!string.IsNullOrWhiteSpace(corrUid))
        {
            _incidentCorr[connectionId] = corrUid;
        }

        return true;
    }

    /// <summary>
    /// I11 B2: откат <see cref="AdoptOpenIncident"/> если Hub.Adopt отказал — без NC-строки.
    /// </summary>
    public bool ClearAdoptedIncident(long connectionId)
    {
        StopTransaqRecoverProgress(connectionId);
        _incidentOwner.TryRemove(connectionId, out _);
        _incidentCorr.TryRemove(connectionId, out _);
        return _incidentSince.TryRemove(connectionId, out _);
    }

    private void RememberOpenCorr(long connectionId, string? corrUid)
    {
        if (!string.IsNullOrWhiteSpace(corrUid))
        {
            _incidentCorr[connectionId] = corrUid;
        }
    }

    /// <summary>
    /// Первый fail connect при отсутствии open break → открыть <c>link:</c> Incident.
    /// Все дальнейшие попытки (auto ×N / ручной тумблер ×25) пишут в этот же corr.
    /// true — только что открыли; false — break уже был.
    /// </summary>
    public bool EnsureBreakIncidentOnConnectFailure(
        long connectionId, DateTimeOffset atTs, string label)
    {
        if (!_incidentSince.TryAdd(connectionId, atTs))
        {
            return false;
        }

        var title = $"{label}: не удалось установить связь";
        // Sync API (connect-fail path): fan-out journal+NC; БД-ошибки глотает JournalRegistrator.
        var corr = FanOutBreakOpenAsync(
                connectionId,
                atTs,
                owner: "supervisor",
                subtype: "down",
                title,
                sender: "supervisor",
                state: "Error",
                detail: null,
                CancellationToken.None)
            .GetAwaiter()
            .GetResult();
        if (corr is null)
        {
            _incidentSince.TryRemove(connectionId, out _);
            _incidentCorr.TryRemove(connectionId, out _);
            return false;
        }

        _incidentOwner[connectionId] = "supervisor";
        RememberOpenCorr(connectionId, corr);
        return true;
    }

    public string GetStatus(long connectionId) =>
        _status.TryGetValue(connectionId, out var status) ? status : "disconnected";

    /// <summary>Сессия уже в памяти (в т.ч. mid-<see cref="ConnectAsync"/>) — не «отклонять» restore.</summary>
    public bool HasSession(long connectionId) => _sessions.ContainsKey(connectionId);

    /// <summary>Оператор чинит open break (ручной тумблер) — вне окна WARN «отклонил» не пишем.</summary>
    public bool IsOperatorReconnectPending(long connectionId) =>
        _operatorReconnect.ContainsKey(connectionId);

    public void BeginOperatorReconnect(long connectionId) =>
        _operatorReconnect[connectionId] = 0;

    public void EndOperatorReconnect(long connectionId) =>
        _operatorReconnect.TryRemove(connectionId, out _);

    /// <summary>
    /// CloseBreak только что прошёл (или journal ещё open на гонке) — не Adopt/stale-NC заново.
    /// </summary>
    public bool IsRecentBreakClose(long connectionId, string? corrUid = null)
    {
        if (!_recentBreakClose.TryGetValue(connectionId, out var recent))
        {
            return false;
        }

        if (DateTimeOffset.UtcNow - recent.At > RecentBreakCloseTtl)
        {
            _recentBreakClose.TryRemove(connectionId, out _);
            return false;
        }

        if (string.IsNullOrWhiteSpace(corrUid) || string.IsNullOrWhiteSpace(recent.CorrUid))
        {
            return true;
        }

        return string.Equals(recent.CorrUid, corrUid, StringComparison.Ordinal);
    }

    private void NoteBreakClosed(long connectionId, string? corrUid, string closeOutcome) =>
        _recentBreakClose[connectionId] = new RecentBreakClose(
            corrUid, closeOutcome, DateTimeOffset.UtcNow);

    /// <summary>Исход close-break: тумблер on → <c>recovered_manual</c>, иначе <c>recovered</c>.</summary>
    private string ResolveRecoveryOutcome(long connectionId) =>
        IsOperatorReconnectPending(connectionId)
            ? NotificationThreadData.OutcomeRecoveredManual
            : NotificationThreadData.OutcomeRecovered;

    /// <summary>Системный ярлык NC: только id (без имени провайдера).</summary>
    public static string ConnLabelSystem(long connectionId) => $"Подключение {connectionId}";

    /// <summary>Пользовательский ярлык NC: id + имя, если задано.</summary>
    public static string ConnLabelUser(long connectionId, string? name) =>
        string.IsNullOrWhiteSpace(name)
            ? $"Подключение {connectionId}"
            : $"Подключение {connectionId} ({name})";

    /// <summary>Alias → <see cref="ConnLabelUser"/> (ручные user-события из endpoints).</summary>
    public static string ConnLabel(long connectionId, string? name) => ConnLabelUser(connectionId, name);

    /// <summary>NC <c>connection.connect_failed</c>: короткий заголовок без дубля детали;
    /// сырой хвост → <c>data.error_message</c>; <c>data.sender</c> = origin (transaq / backend).
    /// Пример: message «… — TRANSAQ connect failed», error_message = «connection error».</summary>
    public static (string Message, object Data) FormatConnectFailedNotification(
        long connectionId, string label, string exceptionMessage)
    {
        const string headline = "TRANSAQ connect failed";
        var isTransaq = exceptionMessage.StartsWith(headline, StringComparison.OrdinalIgnoreCase);
        var message = isTransaq
            ? $"{label}: не удалось подключиться — {headline}"
            : $"{label}: не удалось подключиться";
        return (message, new
        {
            connectionId,
            state = "Error",
            error_message = ExtractTransaqErrorMessage(exceptionMessage),
            sender = isTransaq ? "transaq" : "backend",
        });
    }

    /// <summary>Хвост после <c>TRANSAQ connect failed:</c> → <c>data.error_message</c>; иначе целое сообщение.</summary>
    public static string? ExtractTransaqErrorMessage(string exceptionMessage)
    {
        const string headline = "TRANSAQ connect failed";
        if (!exceptionMessage.StartsWith(headline, StringComparison.OrdinalIgnoreCase))
        {
            return string.IsNullOrWhiteSpace(exceptionMessage) ? null : exceptionMessage;
        }

        var rest = exceptionMessage[headline.Length..].TrimStart();
        if (rest.StartsWith(':'))
        {
            rest = rest[1..].Trim();
        }

        return string.IsNullOrEmpty(rest) ? null : rest;
    }

    /// <summary>Системный ярлык (manager/supervisor): всегда <c>Подключение {id}</c>, без имени.</summary>
    public ValueTask<string> ResolveLabelAsync(long connectionId, CancellationToken cancellationToken)
    {
        _ = cancellationToken;
        return ValueTask.FromResult(ConnLabelSystem(connectionId));
    }

    /// <summary>Данные NC для <c>connection.connected</c>. Вызывать ДО нового Heartbeat — иначе «предыдущим»
    /// станет текущий сеанс. Expanded = JSON (<c>result</c> + <c>sender</c>), без <c>lines</c>.</summary>
    public async Task<object> FormatConnectedNotifyDataAsync(
        long connectionId, string sender, CancellationToken cancellationToken, string? autoNote = null)
    {
        var connection = await connectionStore.GetAsync(connectionId, cancellationToken).ConfigureAwait(false);
        LinkInterval? previous = null;
        if (connection is not null)
        {
            previous = await linkLiveness.GetLastAsync(connection.SourceId, cancellationToken).ConfigureAwait(false);
        }

        return FormatConnectedNotificationData(connectionId, previous, sender, autoNote);
    }

    /// <summary>NC <c>connection.connected</c>: итог пред. сеанса в <c>result</c> (не <c>message</c> — то заголовок).</summary>
    public static object FormatConnectedNotificationData(
        long connectionId, LinkInterval? previous, string sender, string? autoNote = null)
    {
        var prev = FormatPreviousConnectionResult(previous);
        var result = string.IsNullOrEmpty(autoNote) ? prev : $"{autoNote}. {prev}";
        return new { connectionId, result, sender };
    }

    /// <summary>Одна строка итога (join <c>"; "</c>): «Предыдущее подключение — … МСК; Пред. сеанс — &lt;причина&gt;»
    /// или «Первое подключение.»</summary>
    public static string FormatPreviousConnectionResult(LinkInterval? previous)
    {
        if (previous is null)
        {
            return "Первое подключение.";
        }

        var msk = previous.From.ToOffset(TimeSpan.FromHours(3));
        var head = $"Предыдущее подключение — {msk:dd.MM.yyyy HH:mm} МСК";
        return previous.CloseReason is { } r
            ? $"{head}; Пред. сеанс — {LinkCloseReasonText(r)}"
            : head;
    }

    private static string LinkCloseReasonText(LinkCloseReason reason) => reason switch
    {
        LinkCloseReason.Disconnected => "отключение оператором",
        LinkCloseReason.ServerDown => "обрыв связи",
        LinkCloseReason.PingFailed => "нет ответа",
        LinkCloseReason.Interrupted => "перезапуск",
        LinkCloseReason.Scheduled => "плановое отключение по расписанию",
        LinkCloseReason.Degraded => "восстановление связи (TRANSAQ)",
        _ => "—",
    };

    public IMarketConnector? GetConnector(long connectionId) =>
        _sessions.TryGetValue(connectionId, out var session) ? session.Connector : null;

    public bool TryGetSourceId(long connectionId, out short sourceId) =>
        _sourceIds.TryGetValue(connectionId, out sourceId);

    public DateTimeOffset? GetLastData(long connectionId) =>
        _lastData.TryGetValue(connectionId, out var ts) ? ts : null;

    public IReadOnlyList<LiveConnectionSnapshot> ListSessions()
    {
        var result = new List<LiveConnectionSnapshot>(_sessions.Count);
        foreach (var (connectionId, session) in _sessions)
        {
            if (_sourceIds.TryGetValue(connectionId, out var sourceId))
            {
                result.Add(new LiveConnectionSnapshot(connectionId, sourceId, session.Connector));
            }
        }

        return result;
    }

    /// <summary>
    /// Установить связь. <see cref="ConnectResult.ReadyAt"/> — единый <c>ts</c> для
    /// <c>link_liveness</c> Heartbeat и NC <c>connection.connected</c> (после подписок).
    /// </summary>
    public async Task<ConnectResult> ConnectAsync(long connectionId, CancellationToken cancellationToken)
    {
        if (_sessions.ContainsKey(connectionId))
        {
            var status = GetStatus(connectionId);
            if (status is "waiting" or "active" or "degraded")
            {
                return new ConnectResult(status, DateTimeOffset.UtcNow);
            }

            // Осиротевшая сессия после Down/Error: статус disconnected, но коннектор ещё в памяти —
            // без этого connect мгновенно возвращает disconnected и тумблер «отскакивает».
            logger.LogInformation(
                "Подключение {ConnectionId}: переподключение (предыдущий статус {Status})",
                connectionId, status);
            await DisconnectAsync(connectionId, cancellationToken).ConfigureAwait(false);
        }

        var connection = await connectionStore.GetAsync(connectionId, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException($"Подключение {connectionId} не найдено");

        var creds = ResolveCredentials(connectionId, connection.Kind);

        using var settings = JsonDocument.Parse(string.IsNullOrWhiteSpace(connection.Settings) ? "{}" : connection.Settings);
        IMarketConnector? connector = null;
        var connectStartedAt = System.Diagnostics.Stopwatch.GetTimestamp();
        try
        {
            logger.LogInformation(
                "Подключение {ConnectionId} ({Kind}): попытка установить соединение",
                connectionId, connection.Kind);
            connector = factory.Create(connection.Kind, settings.RootElement, creds);
            await connector.ConnectAsync(cancellationToken).ConfigureAwait(false);

            var sourceId = await sourceStore.ResolveIdAsync(connector.SourceCode, cancellationToken).ConfigureAwait(false);

            var session = new ConnectorSession(
                connector, parser, registry, sourceStore, normalizer, batcher, coverageTracker,
                loggerFactory.CreateLogger<ConnectorSession>(),
                onData: () => ReportActivity(connectionId),
                onLinkState: change => HandleLinkStateAsync(connectionId, change));
            // Сессию в словарь ДО StartAsync: иначе Live из канала (уже залитый в ConnectAsync) обрабатывается
            // HandleLinkStateAsync при пустом _sessions → early-return → OnLinkLiveAsync не зовётся (I6-регресс
            // на ручном/супервизорном Connect: «recovered» + зелёный тумблер, подписок нет, сделок нет).
            _sessions[connectionId] = session;
            _sourceIds[connectionId] = sourceId;
            connector = null;
            await session.StartAsync(cancellationToken).ConfigureAwait(false);

            // Подключено, но данных ещё нет → «ожидание» (перейдёт в «active» при первой сделке).
            SetStatus(connectionId, "waiting");
            EnsureIdleMonitor();
            // Ре-подписка до Heartbeat: ReadyAt = момент готовности линка (после подписок).
            // OnLinkLiveAsync идемпотентен (пропуск при active coverage).
            await recordings.Value.OnLinkLiveAsync(connectionId, cancellationToken).ConfigureAwait(false);
            var readyAt = DateTimeOffset.UtcNow;
            // Открываем интервал link_liveness тем же ts, что уйдёт в NC connection.connected.
            await linkLiveness
                .HeartbeatAsync(sourceId, readyAt, LinkMaxGap, cancellationToken)
                .ConfigureAwait(false);
            // 7j.20 J3/J6: успешный (ре)коннект = связь снова жива. Свежая сессия НЕ даёт отдельного
            // перехода в Live → закрываем open break здесь (recovered с тем же readyAt).
            await CloseIncidentAsync(connectionId, readyAt, cancellationToken).ConfigureAwait(false);
            _firstTradePending[connectionId] = readyAt;
            var connectElapsed = System.Diagnostics.Stopwatch.GetElapsedTime(connectStartedAt);
            logger.LogInformation(
                "Подключение {ConnectionId} ({Kind}) установлено за {ElapsedMs:0} мс (рукопожатие TRANSAQ/Finam)",
                connectionId, connection.Kind, connectElapsed.TotalMilliseconds);
            return new ConnectResult("waiting", readyAt);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(
                ex, "Подключение {ConnectionId} ({Kind}): попытка не удалась", connectionId, connection.Kind);
            throw;
        }
        finally
        {
            if (connector is not null)
            {
                await connector.DisposeAsync().ConfigureAwait(false);
            }
        }
    }

    /// <summary>Отмечает поступление данных от коннектора: waiting → active (idle-монитор вернёт назад).</summary>
    public void ReportActivity(long connectionId)
    {
        _lastData[connectionId] = DateTimeOffset.UtcNow;
        if (_firstTradePending.TryRemove(connectionId, out var connectedAt))
        {
            logger.LogInformation(
                "Подключение {ConnectionId}: первые данные через {ElapsedMs:0} мс после установки связи",
                connectionId, (DateTimeOffset.UtcNow - connectedAt).TotalMilliseconds);
        }

        if (GetStatus(connectionId) == "waiting")
        {
            SetStatus(connectionId, "active");
        }

        _ = liveness.Value.OnDataAsync(connectionId, CancellationToken.None);
    }

    public async Task<string> DisconnectAsync(
        long connectionId,
        CancellationToken cancellationToken,
        LinkCloseReason reason = LinkCloseReason.Disconnected)
    {
        var hasSource = _sourceIds.TryGetValue(connectionId, out var sourceId);
        // I11: не invent'им handover на любом teardown. Маркер жёлтое→красное пишут только
        // реальные пути: grace (`HandoverToSupervisorAsync`) и Degraded→Down (`OpenLinkLostAsync`).
        // Manual/schedule abandon клипают дыру своим маркером без фейкового server_down.

        // Сразу off в UI/API — не ждать TRANSAQ SendCommand (на обрыве сети 20–50 с).
        SetStatus(connectionId, "disconnected");

        if (_sessions.TryRemove(connectionId, out var session))
        {
            await session.StopAsync().ConfigureAwait(false);
        }

        _sourceIds.TryRemove(connectionId, out _);
        _lastData.TryRemove(connectionId, out _);
        _firstTradePending.TryRemove(connectionId, out _);
        _linkStates.TryRemove(connectionId, out _);
        _linkSince.TryRemove(connectionId, out _);
        await liveness.Value.OnDisconnectedAsync(connectionId, cancellationToken).ConfigureAwait(false);
        // Сегменты записи закрыть здесь: иначе после reconnect OnLinkLive видел IsActive и
        // пропускал Subscribe → зелёный тумблер без сделок.
        var segmentStatus = reason is LinkCloseReason.Disconnected or LinkCloseReason.Scheduled
            ? "stopped"
            : "disconnected";
        await recordings.Value
            .OnLinkDownAsync(connectionId, segmentStatus, DateTimeOffset.UtcNow, cancellationToken)
            .ConfigureAwait(false);
        // Закрываем живость связи с причиной: ручной дисконнект — 'disconnected' (серый, не разрыв);
        // плановое гашение по авто-расписанию — 'scheduled' (не путать с «отключением оператором»).
        if (hasSource)
        {
            await linkLiveness
                .CloseAsync(sourceId, reason, null, cancellationToken)
                .ConfigureAwait(false);
        }

        return "disconnected";
    }

    /// <summary>
    /// Phase 7j.20 (J3): owner <c>transaq</c>→<c>supervisor</c> по истечении
    /// <see cref="OhsOptions.LinkRecoverGraceSeconds"/> (T, по умолчанию 60 с). TRANSAQ не восстановил
    /// линк ① сам — форс-дисконнект и connect ×5 (плечо ②). Раньше T то же владение отдаётся из
    /// <see cref="OpenLinkLostAsync"/> при Down/Error/ping (TRANSAQ сдался). Инцидент не закрывается.
    /// </summary>
    public async Task HandoverToSupervisorAsync(long connectionId, DateTimeOffset atTs, CancellationToken cancellationToken)
    {
        await TransferBreakOwnerToSupervisorAsync(
                connectionId, atTs, LinkCloseReason.ServerDown, cancellationToken)
            .ConfigureAwait(false);
        logger.LogWarning(
            "Подключение {ConnectionId}: TRANSAQ не восстановил связь за grace T — owner=supervisor (форс-дисконнект)",
            connectionId);

        // Форс-гасим залипшую сессию: DisconnectAsync снимает сессию/подписки и ставит status=disconnected,
        // НЕ трогая _incidentSince → инцидент продолжается. Открытого link-интервала в Degraded нет, поэтому
        // внутренний CloseAsync(ServerDown) — no-op (границу уже поставил маркер выше). Дальше связь поднимет
        // супервизор (connect ×5, ветка «не connected» в ReconcileOneAsync).
        await DisconnectAsync(connectionId, cancellationToken, LinkCloseReason.ServerDown).ConfigureAwait(false);
        await NotifyBreakHandedOverAsync(connectionId, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Единая смена owner break: <c>transaq</c>→<c>supervisor</c>.
    /// In-memory + нулевой маркер в <c>link_liveness</c> ⇒ на ленте жёлтое|красное с <c>escalatedAt</c>
    /// (owner=transaq → жёлтый, owner=supervisor → красный сплошной).
    /// </summary>
    private async Task TransferBreakOwnerToSupervisorAsync(
        long connectionId,
        DateTimeOffset atTs,
        LinkCloseReason reason,
        CancellationToken cancellationToken)
    {
        _incidentOwner[connectionId] = "supervisor";
        short? sourceId = null;
        if (_sourceIds.TryGetValue(connectionId, out var liveSourceId))
        {
            sourceId = liveSourceId;
        }
        else
        {
            // Сессию могли снять раньше — маркер всё равно нужен для жёлтое→красное на ленте.
            var connection = await connectionStore.GetAsync(connectionId, cancellationToken).ConfigureAwait(false);
            sourceId = connection?.SourceId;
        }

        if (sourceId is { } sid)
        {
            await linkLiveness
                .InsertBoundaryMarkerAsync(sid, reason, atTs, cancellationToken)
                .ConfigureAwait(false);
        }
        else
        {
            logger.LogWarning(
                "Подключение {ConnectionId}: handover без sourceId — маркер escalatedAt не записан",
                connectionId);
        }

        await fanOut
            .ApplyAsync(
                new IncidentStep(
                    IncidentStepKind.Handover,
                    LinkIncidentSubject(connectionId),
                    atTs,
                    ConnectionId: connectionId),
                cancellationToken)
            .ConfigureAwait(false);
    }

    private async Task NotifyBreakHandedOverAsync(long connectionId, CancellationToken cancellationToken)
    {
        if (OnBreakHandedOverAsync is { } onHanded)
        {
            try
            {
                await onHanded(connectionId, cancellationToken).ConfigureAwait(false);
                return;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(
                    ex,
                    "Подключение {ConnectionId}: OnBreakHandedOverAsync failed — fallback Nudge",
                    connectionId);
            }
        }

        RequestSupervisorNudge?.Invoke();
    }

    public async Task<string> TestAsync(long connectionId, CancellationToken cancellationToken)
    {
        var connection = await connectionStore.GetAsync(connectionId, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException($"Подключение {connectionId} не найдено");

        var creds = ResolveCredentials(connectionId, connection.Kind);
        IMarketConnector? connector = null;
        try
        {
            using var settings = JsonDocument.Parse(string.IsNullOrWhiteSpace(connection.Settings) ? "{}" : connection.Settings);
            connector = factory.Create(connection.Kind, settings.RootElement, creds);
            await connector.ConnectAsync(cancellationToken).ConfigureAwait(false);
            await connector.DisconnectAsync(cancellationToken).ConfigureAwait(false);
            SetStatus(connectionId, "ok");
            return "ok";
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Проверка подключения {ConnectionId} не удалась", connectionId);
            SetStatus(connectionId, "error");
            return "error";
        }
        finally
        {
            if (connector is not null)
            {
                await connector.DisposeAsync().ConfigureAwait(false);
            }
        }
    }

    /// <summary>
    /// Проверяет настройки/креды без персистентности: поднимает коннектор из
    /// переданных <paramref name="kind"/>/<paramref name="settings"/> и сразу гасит.
    /// Ничего не пишет в БД и не трогает <see cref="ICredentialStore"/>.
    /// </summary>
    public async Task<(bool Ok, string? Message)> ValidateAsync(
        string kind, string settings, ConnectorCredentials? creds, CancellationToken cancellationToken)
    {
        creds ??= kind == "transaq" ? DevLocalTransaqCredentials.TryCreate(transaqDefaults) : null;
        IMarketConnector? connector = null;
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(settings) ? "{}" : settings);
            connector = factory.Create(kind, doc.RootElement, creds);
            await connector.ConnectAsync(cancellationToken).ConfigureAwait(false);
            await connector.DisconnectAsync(cancellationToken).ConfigureAwait(false);
            return (true, null);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Валидация настроек подключения ({Kind}) не удалась", kind);
            return (false, ex.Message);
        }
        finally
        {
            if (connector is not null)
            {
                await connector.DisposeAsync().ConfigureAwait(false);
            }
        }
    }

    /// <summary>
    /// Диагностика: <c>get_securities_info</c> по market/seccode на живой TRANSAQ-сессии.
    /// </summary>
    public async Task<(int MarketId, SecurityProbeResult Result)> ProbeSecurityAsync(
        long connectionId, int? market, string? board, string seccode, int? timeoutSeconds, CancellationToken cancellationToken)
    {
        var connector = GetConnector(connectionId)
            ?? throw new InvalidOperationException($"Подключение {connectionId} не активно — сначала connect");

        if (connector is not ISecurityCatalogProbe probe)
        {
            throw new InvalidOperationException("Probe security доступен только для TRANSAQ-коннектора");
        }

        if (!connector.IsConnected)
        {
            throw new InvalidOperationException($"Подключение {connectionId} не в состоянии connected");
        }

        var codeTrim = seccode.Trim();
        if (codeTrim.Length == 0)
        {
            throw new InvalidOperationException("Нужен seccode");
        }

        var marketId = ResolveProbeMarket(market, board);
        var timeout = TimeSpan.FromSeconds(Math.Clamp(timeoutSeconds ?? 10, 1, 60));
        logger.LogInformation(
            "Подключение {ConnectionId}: probe security {Seccode} market={Market} (timeout {Timeout}s)",
            connectionId, codeTrim, marketId, timeout.TotalSeconds);

        var result = await probe
            .ProbeSecurityAsync(marketId, codeTrim, timeout, cancellationToken)
            .ConfigureAwait(false);

        logger.LogInformation(
            "Подключение {ConnectionId}: probe {Seccode} market={Market} → accepted={Accepted} found={Found}: {Message}",
            connectionId, codeTrim, marketId, result.CommandAccepted, result.FoundInCallback, result.Message);

        return (marketId, result);
    }

    /// <summary>FORTS OPT/FUT → market 4; иначе market обязателен явно.</summary>
    private static int ResolveProbeMarket(int? market, string? board)
    {
        if (market is > 0)
        {
            return market.Value;
        }

        return board?.Trim().ToUpperInvariant() switch
        {
            "OPT" or "FUT" => 4,
            "TQBR" => 1,
            _ => throw new InvalidOperationException(
                "Укажите market (для FORTS-опционов: 4) или board=OPT/FUT"),
        };
    }

    public async Task StopAllAsync(CancellationToken cancellationToken)
    {
        foreach (var connectionId in _sessions.Keys.ToList())
        {
            await DisconnectAsync(connectionId, cancellationToken).ConfigureAwait(false);
        }

        TransaqConnector.ShutdownNative();
    }

    /// <summary>
    /// Эмуляция обрыва связи (phase 7h.7, только synthetic в Development).
    /// Возвращает false, если коннектор не поддерживает инжект.
    /// </summary>
    public bool TryDebugDrop(long connectionId, TimeSpan duration)
    {
        if (GetConnector(connectionId) is not SyntheticLiveConnector synthetic)
        {
            return false;
        }

        _ = synthetic.SimulateDropAsync(duration, CancellationToken.None);
        return true;
    }

    private void SetStatus(long connectionId, string status)
    {
        _status[connectionId] = status;
        broadcaster.Broadcast(new ConnectionStatusChangedEvent(connectionId, status));
    }

    private ConnectorCredentials? ResolveCredentials(long connectionId, string kind)
    {
        if (credentials.TryGet(connectionId, out var value))
        {
            return value;
        }

        return kind == "transaq"
            ? DevLocalTransaqCredentials.TryCreate(transaqDefaults)
            : null;
    }

    /// <summary>Реакция на <c>server_status</c> от коннектора (phase 7h.4). Вызывается строго
    /// последовательно из pump-цикла сессии (await), поэтому previous-состояние достоверно.</summary>
    private async Task HandleLinkStateAsync(long connectionId, ConnectorLinkStateChange change)
    {
        // Событие связи по подключению без активной сессии — штатный teardown (DisconnectAsync снял
        // сессию до StopAsync) либо шум при старте: не инцидент, не трогаем живость/статус.
        if (!_sessions.ContainsKey(connectionId))
        {
            return;
        }

        var hadState = _linkStates.TryGetValue(connectionId, out var previous);
        var prevSince = _linkSince.TryGetValue(connectionId, out var since) ? since : (DateTimeOffset?)null;
        var lastData = GetLastData(connectionId);
        var nowWall = DateTimeOffset.UtcNow;
        var silentSec = lastData is { } ld ? (nowWall - ld).TotalSeconds : (double?)null;
        var heldSec = prevSince is { } ps ? (change.At - ps).TotalSeconds : (double?)null;
        // Debug: диагностика latency soft-disconnect; в Information/Warning — шум на каждом тике.
        logger.LogDebug(
            "LinkDetect: conn={ConnectionId} {Prev}→{Next} eventAt={At:HH:mm:ss.fff} wall={Wall:HH:mm:ss.fff} " +
            "heldPrev={HeldSec:0.#}s silentData={SilentSec} status={Status} detail={Detail}",
            connectionId,
            hadState ? previous.ToString() : "null",
            change.State,
            change.At,
            nowWall,
            heldSec,
            silentSec is { } s ? $"{s:0.#}s" : "n/a",
            GetStatus(connectionId),
            change.Detail);

        _linkStates[connectionId] = change.State;
        _linkSince[connectionId] = change.At;
        PublishLinkState(connectionId, change);

        switch (change.State)
        {
            case ConnectorLinkState.Live:
            {
                // Flap Degraded→Live до confirm: снять отложенный open — без journal и без зелёного маркера.
                CancelDegradedConfirm(connectionId);

                // Связь ЖИВА (server_status connected=true, recover=false): открываем/продлеваем интервал
                // живости связи (лента Connection, 7h.8). Единственное «здоровое» состояние (7j.20).
                // DB/side-effects в try: сбой пула не должен блокировать CloseIncident/статус.
                if (_sourceIds.TryGetValue(connectionId, out var liveSourceId))
                {
                    try
                    {
                        await linkLiveness
                            .HeartbeatAsync(liveSourceId, change.At, LinkMaxGap, CancellationToken.None)
                            .ConfigureAwait(false);
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        logger.LogError(ex, "Подключение {ConnectionId}: Heartbeat link_liveness на Live", connectionId);
                    }
                }

                var recovering = hadState && previous is ConnectorLinkState.Down or ConnectorLinkState.Error or ConnectorLinkState.Degraded;

                // Закрываем инцидент связи по факту «связь снова жива» (7j.19/I2, 7j.20 J3): опираемся на
                // _incidentSince, не на in-memory previous (реконнект супервизора идёт через полный
                // DisconnectAsync, стелс-разрыв — без server_status Down). Общий путь с успешным реконнектом
                // супервизора — см. CloseIncidentAsync.
                // Если Manager уже пуст (гонка Open/journal), а Hub ещё open — добиваем orphan Resolve.
                if (!await CloseIncidentAsync(connectionId, change.At, CancellationToken.None)
                        .ConfigureAwait(false))
                {
                    await TryResolveOrphanOpenBreakAsync(connectionId, change.At, CancellationToken.None)
                        .ConfigureAwait(false);
                }

                // Ре-подписку НЕЛЬЗЯ гейтить in-memory `recovering` (7j.19/I6): реконнект супервизора идёт
                // через полный DisconnectAsync (стирает _linkStates) → на первом Live новой сессии
                // hadState=false ⇒ recovering=false ⇒ ре-подписка терялась: связь «зелёная» (waiting), но
                // подписок TRANSAQ на новой сессии нет → сделок нет. Для TRANSAQ это ВСЕГДА (восстановление
                // только через новую сессию, server_status Down не приходит). OnLinkLiveAsync идемпотентен
                // (пропускает записи с активным покрытием), поэтому безопасно звать на любом Live/Degraded.
                try
                {
                    await recordings.Value.OnLinkLiveAsync(connectionId, CancellationToken.None).ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogError(ex, "Подключение {ConnectionId}: OnLinkLive на Live", connectionId);
                }

                if (recovering || GetStatus(connectionId) is "disconnected" or "error" or "degraded")
                {
                    SetStatus(connectionId, StatusForLinkState(ConnectorLinkState.Live));
                }

                logger.LogInformation(
                    "Подключение {ConnectionId}: связь Live{Recovering}",
                    connectionId, recovering ? " (ре-подписка)" : "");
                break;
            }

            case ConnectorLinkState.Degraded:
            {
                // Phase 7j.20: Degraded — инцидент, но TRANSAQ часто мигает recover≈1с.
                // Confirm-delay: flap Live до истечения → без journal/green; иначе open с t0=первый Degraded.
                //
                // Важно: Hub.Open / WS notification — ДО OnLinkLive. PublishLinkState уже ушёл в UI;
                // OnLinkLive → SubscribeTradesAsync при мёртвой сети висит (десятки секунд) и раньше
                // откладывал connection.lost — тумблер «Связь потеряна», а NC пустой.
                SetStatus(connectionId, StatusForLinkState(ConnectorLinkState.Degraded));

                if (_incidentSince.ContainsKey(connectionId))
                {
                    // Уже подтверждённый open break — только поддерживаем дыру liveness/capture.
                    try
                    {
                        await ApplyDegradedSideEffectsAsync(connectionId, change.At, CancellationToken.None)
                            .ConfigureAwait(false);
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        logger.LogError(ex, "Подключение {ConnectionId}: side-effects Degraded", connectionId);
                    }
                }
                else if (DegradedConfirmDelay <= TimeSpan.Zero)
                {
                    await ConfirmDegradedIncidentAsync(connectionId, change.At, change.Detail, CancellationToken.None)
                        .ConfigureAwait(false);
                }
                else
                {
                    _degradedPending[connectionId] = (change.At, change.Detail);
                    var cts = new CancellationTokenSource();
                    if (_degradedConfirm.TryRemove(connectionId, out var prevCts))
                    {
                        prevCts.Cancel();
                        prevCts.Dispose();
                    }

                    _degradedConfirm[connectionId] = cts;
                    logger.LogInformation(
                        "Подключение {ConnectionId}: Degraded — confirm через {DelaySec:0.#}с ({Detail})",
                        connectionId, DegradedConfirmDelay.TotalSeconds, change.Detail);
                    _ = ConfirmDegradedAfterDelayAsync(connectionId, cts.Token);
                }

                // Не await: SubscribeTrades при обрыве сети может висеть минутами и блокировал
                // pump (Down/Progress). NC уже открыт выше — ре-подписка best-effort в фоне.
                _ = OnLinkLiveBestEffortAsync(connectionId);

                break;
            }

            case ConnectorLinkState.Down:
            case ConnectorLinkState.Error:
            {
                // Down/Error важнее debounce: сразу фиксируем break (после flush pending Degraded).
                await FlushDegradedConfirmNowAsync(connectionId, change.At, CancellationToken.None)
                    .ConfigureAwait(false);

                var wasUp = !hadState || previous is ConnectorLinkState.Live or ConnectorLinkState.Degraded;
                if (!wasUp)
                {
                    break;
                }

                var segmentStatus = change.State == ConnectorLinkState.Error ? "error" : "disconnected";
                logger.LogWarning(
                    "Подключение {ConnectionId}: связь {State} ({Detail})",
                    connectionId, change.State, change.Detail);

                var lostLabel = await ResolveLabelAsync(connectionId, CancellationToken.None).ConfigureAwait(false);
                await OpenLinkLostAsync(
                    connectionId,
                    change.At,
                    $"{lostLabel}: связь потеряна ({change.State})",
                    LinkCloseReason.ServerDown,
                    segmentStatus,
                    change.State,
                    change.Detail,
                    sender: "transaq",
                    CancellationToken.None).ConfigureAwait(false);
                break;
            }
        }
    }

    /// <summary>
    /// I11: снять open break в Manager (<c>_incidentSince</c>/<c>_incidentOwner</c>).
    /// Без этого Hub.Resolve оставляет Host в «open» → Progress/Append в пустоту.
    /// </summary>
    private bool TryTakeOpenBreak(long connectionId, out DateTimeOffset incidentStart, out string owner)
    {
        StopTransaqRecoverProgress(connectionId);
        if (!_incidentSince.TryRemove(connectionId, out incidentStart))
        {
            owner = "supervisor";
            return false;
        }

        owner = _incidentOwner.TryRemove(connectionId, out var incidentOwner) ? incidentOwner : "transaq";
        _incidentCorr.TryRemove(connectionId, out _);
        return true;
    }

    /// <summary>
    /// I11: единый close-break — сначала Hub.Resolve (WS), потом Manager clear + маркеры ленты.
    /// Исходы: <c>recovered</c> / <c>recovered_manual</c> / <c>abandoned_manual</c>.
    /// </summary>
    private async Task<bool> CloseBreakAsync(
        long connectionId,
        DateTimeOffset atTs,
        string closeOutcome,
        CancellationToken cancellationToken,
        string? closeNote = null,
        string? resolvedBy = null,
        bool announceOperatorForceClose = true)
    {
        if (!_incidentSince.TryGetValue(connectionId, out var incidentStart))
        {
            return false;
        }

        var owner = _incidentOwner.TryGetValue(connectionId, out var incidentOwner)
            ? incidentOwner
            : "transaq";
        var label = ConnLabelSystem(connectionId);
        var gapLine = FormatGapLine(incidentStart, atTs);
        var subject = LinkIncidentSubject(connectionId);

        var corrUid = GetOpenBreakCorr(connectionId);
        // До await journal: supervisor/Live orphan не должны Adopt этот corr как «ещё open».
        NoteBreakClosed(connectionId, corrUid, closeOutcome);
        IncidentStep resolveStep = closeOutcome switch
        {
            NotificationThreadData.OutcomeAbandonedManual => new IncidentStep(
                IncidentStepKind.Resolve,
                subject,
                atTs,
                CorrUid: corrUid,
                ConnectionId: connectionId,
                CloseOutcome: closeOutcome,
                Severity: "warning",
                NcCode: "connection.incident_closed",
                NcMessage: "Инцидент закрыт оператором",
                NcSeverity: "warning",
                NcData: new
                {
                    connectionId,
                    kind = "break",
                    reason = "manual_journal",
                    sender = "system",
                    result = $"Закрыто оператором; {gapLine}",
                    closeOutcome,
                    closeNote,
                    resolvedBy,
                }),
            NotificationThreadData.OutcomeRecoveredManual => new IncidentStep(
                IncidentStepKind.Resolve,
                subject,
                atTs,
                CorrUid: corrUid,
                ConnectionId: connectionId,
                CloseOutcome: NotificationThreadData.OutcomeRecoveredManual,
                Severity: "ok",
                NcCode: "connection.recovered",
                NcMessage: $"{label}: связь восстановлена оператором",
                NcSeverity: "ok",
                NcData: new
                {
                    connectionId,
                    result = $"Восстановлено оператором; {gapLine}",
                    sender = "user",
                    closeOutcome = NotificationThreadData.OutcomeRecoveredManual,
                }),
            _ => new IncidentStep(
                IncidentStepKind.Resolve,
                subject,
                atTs,
                CorrUid: corrUid,
                ConnectionId: connectionId,
                CloseOutcome: NotificationThreadData.OutcomeRecovered,
                Severity: "ok",
                NcCode: "connection.recovered",
                NcMessage: $"{label}: связь восстановлена",
                NcSeverity: "ok",
                NcData: new
                {
                    connectionId,
                    result = owner == "supervisor"
                        ? $"Восстановлено супервизором (переподключение); {gapLine}"
                        : $"Восстановлено TRANSAQ; {gapLine}",
                    sender = owner,
                    closeOutcome = NotificationThreadData.OutcomeRecovered,
                }),
        };

        // Wizard «Закрыть» в журнале: user·info → system·warning Resolve (тот же corr).
        if (closeOutcome == NotificationThreadData.OutcomeAbandonedManual
            && announceOperatorForceClose
            && !string.IsNullOrWhiteSpace(corrUid))
        {
            NotificationThreadData.PublishOperatorForceClose(
                notifications, corrUid!, subject, atTs, connectionId, closeNote, resolvedBy);
        }

        // WS recovered/closed ДО любых await БД и ДО снятия _incidentSince.
        await fanOut.ApplyAsync(resolveStep, cancellationToken).ConfigureAwait(false);

        if (!TryTakeOpenBreak(connectionId, out _, out _))
        {
            // Уже сняли параллельным close — NC всё равно отправили (Resolve идемпотентен no-op).
            return true;
        }

        // Кэш сессии или store (abandon без живого Connect — unit / offline).
        var sourceId = await ResolveSourceIdAsync(connectionId, cancellationToken).ConfigureAwait(false);

        // Пропущенный grace-tick: Live/abandon после T при owner=transaq → boundary на since+T.
        if (LinkOwnership.CatchUpEscalationAt(owner, incidentStart, atTs, RecoverGrace) is { } catchUpAt
            && sourceId is { } catchUpSid)
        {
            try
            {
                await linkLiveness
                    .InsertBoundaryMarkerAsync(catchUpSid, LinkCloseReason.ServerDown, catchUpAt, cancellationToken)
                    .ConfigureAwait(false);
                logger.LogWarning(
                    "Подключение {ConnectionId}: catch-up escalatedAt={Esc:o} (owner=transaq, elapsed≥T={T}s)",
                    connectionId, catchUpAt, (int)RecoverGrace.TotalSeconds);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Подключение {ConnectionId}: catch-up boundary на close", connectionId);
            }
        }

        if (closeOutcome == NotificationThreadData.OutcomeAbandonedManual && sourceId is { } sid)
        {
            try
            {
                await linkLiveness
                    .InsertBoundaryMarkerAsync(sid, LinkCloseReason.Disconnected, atTs, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Подключение {ConnectionId}: ribbon marker на close", connectionId);
            }
        }

        if (closeOutcome == NotificationThreadData.OutcomeAbandonedManual)
        {
            logger.LogInformation(
                "Подключение {ConnectionId}: break-инцидент закрыт вручную (с {Start:o} по {End:o})",
                connectionId, incidentStart, atTs);
        }
        else if (closeOutcome == NotificationThreadData.OutcomeRecoveredManual)
        {
            logger.LogInformation(
                "Подключение {ConnectionId}: break-инцидент recovered_manual (с {Start:o} по {End:o})",
                connectionId, incidentStart, atTs);
        }
        else
        {
            logger.LogInformation(
                "Подключение {ConnectionId}: break-инцидент recovered (с {Start:o} по {End:o}, owner={Owner})",
                connectionId, incidentStart, atTs, owner);
        }

        return true;
    }

    /// <summary>
    /// Manager пуст, journal/Hub ещё open (гонка или рестарт без adopt) → recovered по journal corr.
    /// Hub без journal — только NC hygiene. Не дублирует только что закрытый CloseBreak.
    /// </summary>
    private async Task<bool> TryResolveOrphanOpenBreakAsync(
        long connectionId, DateTimeOffset atTs, CancellationToken cancellationToken)
    {
        var subject = LinkIncidentSubject(connectionId);
        string? corr = null;
        try
        {
            var journalOpen = await incidentStore
                .FindOpenBreakAsync(connectionId, cancellationToken)
                .ConfigureAwait(false);
            corr = journalOpen?.CorrUid;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Подключение {ConnectionId}: FindOpenBreak на orphan-close", connectionId);
        }

        if (corr is null
            && !notifications.TryGetOpenCorrelationId(subject, out corr))
        {
            return false;
        }

        if (IsRecentBreakClose(connectionId, corr))
        {
            logger.LogDebug(
                "Подключение {ConnectionId}: orphan-close пропущен — break {Corr} только что закрыт",
                connectionId,
                corr);
            return false;
        }

        var closeOutcome = ResolveRecoveryOutcome(connectionId);
        var label = ConnLabelSystem(connectionId);
        var ncMessage = closeOutcome == NotificationThreadData.OutcomeRecoveredManual
            ? $"{label}: связь восстановлена оператором"
            : $"{label}: связь восстановлена";
        logger.LogWarning(
            "Подключение {ConnectionId}: orphan open break {Corr} — Resolve без _incidentSince ({Outcome})",
            connectionId,
            corr,
            closeOutcome);
        NoteBreakClosed(connectionId, corr, closeOutcome);
        await fanOut
            .ApplyAsync(
                new IncidentStep(
                    IncidentStepKind.Resolve,
                    subject,
                    atTs,
                    CorrUid: corr,
                    ConnectionId: connectionId,
                    CloseOutcome: closeOutcome,
                    Severity: "ok",
                    NcCode: "connection.recovered",
                    NcMessage: ncMessage,
                    NcSeverity: "ok",
                    NcData: new
                    {
                        connectionId,
                        result = closeOutcome == NotificationThreadData.OutcomeRecoveredManual
                            ? "Восстановлено оператором; (orphan close)"
                            : "Восстановлено TRANSAQ; (orphan close)",
                        sender = closeOutcome == NotificationThreadData.OutcomeRecoveredManual
                            ? "user"
                            : "transaq",
                        closeOutcome,
                    }),
                cancellationToken)
            .ConfigureAwait(false);
        StopTransaqRecoverProgress(connectionId);
        return true;
    }

    /// <summary>
    /// Закрывает open break: тумблер on (<see cref="IsOperatorReconnectPending"/>) →
    /// <c>recovered_manual</c>; иначе Auto/TRANSAQ → <c>recovered</c>.
    /// </summary>
    private Task<bool> CloseIncidentAsync(
        long connectionId, DateTimeOffset atTs, CancellationToken cancellationToken) =>
        CloseBreakAsync(
            connectionId,
            atTs,
            ResolveRecoveryOutcome(connectionId),
            cancellationToken);

    /// <summary>
    /// Страховка супервизора: link уже Live, а break ещё open (Manager / journal / Hub session) → recovered.
    /// </summary>
    public async Task EnsureBreakClosedIfLiveAsync(long connectionId, DateTimeOffset atTs, CancellationToken cancellationToken)
    {
        if (GetLinkState(connectionId) is not ConnectorLinkState.Live)
        {
            return;
        }

        if (await CloseIncidentAsync(connectionId, atTs, cancellationToken).ConfigureAwait(false))
        {
            return;
        }

        await TryResolveOrphanOpenBreakAsync(connectionId, atTs, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Wizard журнала: open break → <c>abandoned_manual</c> (Manager+Hub), маркер disconnected.
    /// Тумблер off инцидент больше не закрывает — см. <c>ConnectionSupervisor.NotifyOperatorHaltAsync</c>.
    /// </summary>
    public Task<bool> TryAbandonIncidentByManualAsync(
        long connectionId,
        DateTimeOffset atTs,
        CancellationToken cancellationToken,
        string? closeNote = null,
        string? resolvedBy = null,
        bool announceOperatorForceClose = true) =>
        CloseBreakAsync(
            connectionId,
            atTs,
            NotificationThreadData.OutcomeAbandonedManual,
            cancellationToken,
            closeNote,
            resolvedBy,
            announceOperatorForceClose);

    private async Task<short?> ResolveSourceIdAsync(long connectionId, CancellationToken cancellationToken)
    {
        if (_sourceIds.TryGetValue(connectionId, out var liveSourceId))
        {
            return liveSourceId;
        }

        var connection = await connectionStore.GetAsync(connectionId, cancellationToken).ConfigureAwait(false);
        return connection?.SourceId;
    }

    /// <summary>I2: open break → fan-out (Hub + journal, один corr). <c>null</c> — Hub.Open отказал.</summary>
    private Task<string?> FanOutBreakOpenAsync(
        long connectionId,
        DateTimeOffset openedAt,
        string owner,
        string subtype,
        string title,
        string sender,
        string state,
        string? detail,
        CancellationToken cancellationToken)
    {
        // Только кэш: await connectionStore до Hub.Open откладывал WS lost при забитом пуле Npgsql.
        short? sourceId = _sourceIds.TryGetValue(connectionId, out var cached) ? cached : null;
        return fanOut.ApplyAsync(
            new IncidentStep(
                IncidentStepKind.Open,
                LinkIncidentSubject(connectionId),
                openedAt,
                ConnectionId: connectionId,
                SourceId: sourceId,
                Owner: owner,
                Subtype: subtype,
                Title: title,
                Severity: "error",
                NcCode: "connection.lost",
                NcMessage: title,
                NcSeverity: "error",
                NcData: new
                {
                    connectionId,
                    state,
                    detail,
                    sender,
                    threadKindHint = NotificationThreadData.KindIncident,
                }),
            cancellationToken);
    }

    /// <summary>
    /// Открывает инцидент связи (`connection.lost`), закрывает живость связи причиной <paramref name="reason"/>
    /// на момент <paramref name="atTs"/> (честная граница дыры), гасит захват и статус. Общий путь для
    /// server_status Down и синтетического стелс-разрыва по пингу (7j.19/I3). Идемпотентен по инциденту:
    /// повторный Open по тому же subject — no-op; _incidentSince фиксирует НАЧАЛО (earliest wins).
    /// </summary>
    private async Task OpenLinkLostAsync(
        long connectionId,
        DateTimeOffset atTs,
        string message,
        LinkCloseReason reason,
        string segmentStatus,
        ConnectorLinkState state,
        string? detail,
        string sender,
        CancellationToken cancellationToken,
        bool grantTransaqGrace = false)
    {
        var subject = LinkIncidentSubject(connectionId);
        var isNew = _incidentSince.TryAdd(connectionId, atTs);
        // Break open → всегда Incident + journal (P3). Desired влияет на Auto connect, не на SkipJournal.
        var lostData = new
        {
            connectionId,
            state = state.ToString(),
            detail,
            sender,
            threadKindHint = NotificationThreadData.KindIncident,
        };
        if (isNew)
        {
            // server_status Down/Error — TRANSAQ сдался → supervisor с t0.
            // Ping-stall при живой сессии — сначала grace T (тики), как Degraded.
            var owner = grantTransaqGrace ? "transaq" : "supervisor";
            var corr = await FanOutBreakOpenAsync(
                    connectionId,
                    atTs,
                    owner: owner,
                    subtype: grantTransaqGrace ? "degraded" : "down",
                    message,
                    sender,
                    state: state.ToString(),
                    detail,
                    cancellationToken)
                .ConfigureAwait(false);
            if (corr is null)
            {
                _incidentSince.TryRemove(connectionId, out _);
                _incidentCorr.TryRemove(connectionId, out _);
                logger.LogError(
                    "Подключение {ConnectionId}: FanOut open отказал на Down/Error — откат _incidentSince",
                    connectionId);
            }
            else
            {
                _incidentOwner[connectionId] = owner;
                RememberOpenCorr(connectionId, corr);
                if (grantTransaqGrace)
                {
                    StartTransaqRecoverProgress(connectionId, atTs);
                    RequestSupervisorNudge?.Invoke();
                    logger.LogWarning(
                        "Подключение {ConnectionId}: ping-stall — инцидент (владелец TRANSAQ, grace T)",
                        connectionId);
                }
                else
                {
                    StopTransaqRecoverProgress(connectionId);
                    await NotifyBreakHandedOverAsync(connectionId, cancellationToken).ConfigureAwait(false);
                }
            }

            if (_sourceIds.TryGetValue(connectionId, out var srcId))
            {
                var closed = await linkLiveness
                    .CloseAsync(srcId, reason, atTs, cancellationToken)
                    .ConfigureAwait(false);
                // Уже закрыто как Degraded, а _incidentSince сбросили (рестарт/рассинхрон) —
                // Close no-op; ставим маркер, иначе вся дыра останется жёлтой.
                if (closed == 0)
                {
                    await linkLiveness
                        .InsertBoundaryMarkerAsync(srcId, reason, atTs, cancellationToken)
                        .ConfigureAwait(false);
                }
            }
        }
        else
        {
            // TRANSAQ сдался раньше T (или уже был Degraded): та же смена owner, что и grace-handover.
            // Append — mid-thread (не Open); fan-out Handover обновляет journal owner/escalated.
            StopTransaqRecoverProgress(connectionId);
            notifications.Append(
                subject, "connection.lost", message, severity: "error", data: lostData, ts: atTs);
            await TransferBreakOwnerToSupervisorAsync(connectionId, atTs, reason, cancellationToken)
                .ConfigureAwait(false);
            await NotifyBreakHandedOverAsync(connectionId, cancellationToken).ConfigureAwait(false);
        }

        await liveness.Value.OnServerDownAsync(connectionId, atTs, cancellationToken).ConfigureAwait(false);
        await recordings.Value.OnLinkDownAsync(connectionId, segmentStatus, atTs, cancellationToken).ConfigureAwait(false);
        // Grace T: статус degraded → IsConnected, супервизор не рвёт Connect до handover.
        SetStatus(
            connectionId,
            grantTransaqGrace && isNew
                ? StatusForLinkState(ConnectorLinkState.Degraded)
                : StatusForLinkState(state));
    }

    /// <summary>
    /// Стелс-разрыв данных (7j.19/I3): тишина сделок дольше порога + активный пинг НЕ прошёл ⇒ связь мертва,
    /// хотя коннектор ещё считает себя connected (server_status Down не пришёл). Фиксируем инцидент с началом
    /// = последняя сделка (<paramref name="lastActivityAt"/>) — честная левая граница дыры. Дедуп: если
    /// инцидент уже открыт или статус уже «вниз» — тихо выходим (тик 15 c не должен спамить).
    /// Сессия ещё жива → owner=transaq + тики NC, через T — handover супервизору (как Degraded).
    /// </summary>
    public async Task ReportStallAsync(long connectionId, DateTimeOffset lastActivityAt, CancellationToken cancellationToken)
    {
        if (!_sessions.ContainsKey(connectionId))
        {
            return;
        }

        if (_incidentSince.ContainsKey(connectionId) || GetStatus(connectionId) is "disconnected" or "error")
        {
            return;
        }

        // Как Degraded: жёлтая фаза TRANSAQ (тики + grace T), не мгновенный supervisor.
        _linkStates[connectionId] = ConnectorLinkState.Degraded;
        _linkSince[connectionId] = lastActivityAt;
        var label = await ResolveLabelAsync(connectionId, cancellationToken).ConfigureAwait(false);
        logger.LogWarning(
            "Подключение {ConnectionId}: тишина сделок дольше порога + пинг не прошёл — фиксирую разрыв с {At:o}",
            connectionId, lastActivityAt);

        await OpenLinkLostAsync(
            connectionId,
            lastActivityAt,
            $"{label}: связь потеряна (нет данных)",
            LinkCloseReason.PingFailed,
            "disconnected",
            ConnectorLinkState.Degraded,
            "нет данных: активный пинг не прошёл",
            sender: "transaq",
            cancellationToken,
            grantTransaqGrace: true).ConfigureAwait(false);
    }

    /// <summary>Строка разрыва для expanded recovered: «Разрыв HH:mm:ss → HH:mm:ss (МСК), длительность HH:MM:SS».
    /// Если разрыв пересекает сутки — к границам добавляется дата.</summary>
    private static string FormatGapLine(DateTimeOffset from, DateTimeOffset to)
    {
        var dur = to - from;
        var fromMsk = from.ToOffset(TimeSpan.FromHours(3));
        var toMsk = to.ToOffset(TimeSpan.FromHours(3));
        var hhmmss = $"{(int)dur.TotalHours:00}:{dur.Minutes:00}:{dur.Seconds:00}";
        var sameDay = fromMsk.Date == toMsk.Date;
        var fromText = sameDay ? $"{fromMsk:HH:mm:ss}" : $"{fromMsk:dd.MM HH:mm:ss}";
        var toText = sameDay ? $"{toMsk:HH:mm:ss}" : $"{toMsk:dd.MM HH:mm:ss}";
        return $"Разрыв {fromText} → {toText} (МСК), длительность {hhmmss}";
    }

    private void PublishLinkState(long connectionId, ConnectorLinkStateChange change)
    {
        broadcaster.Broadcast(new ConnectionStateChangedEvent(
            connectionId,
            change.State.ToString(),
            change.At,
            change.Detail));
    }

    private static string StatusForLinkState(ConnectorLinkState state) => state switch
    {
        ConnectorLinkState.Live => "waiting",
        ConnectorLinkState.Degraded => "degraded",
        ConnectorLinkState.Down => "disconnected",
        ConnectorLinkState.Error => "error",
        _ => "disconnected",
    };

    /// <summary>Лениво запускает опрос простоя (тик 1с) при первом подключении.</summary>
    private void EnsureIdleMonitor() =>
        _idleMonitor ??= new Timer(_ => SweepIdle(), null, TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(1));

    /// <summary>Опрос активных сессий: active → waiting, если данных нет дольше <see cref="_idleThreshold"/>.</summary>
    private void SweepIdle()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var connectionId in _sessions.Keys)
        {
            if (GetStatus(connectionId) != "active")
            {
                continue;
            }

            var last = _lastData.TryGetValue(connectionId, out var t) ? t : DateTimeOffset.MinValue;
            if (now - last > _idleThreshold)
            {
                SetStatus(connectionId, "waiting");
            }
        }
    }

    private void CancelDegradedConfirm(long connectionId)
    {
        _degradedPending.TryRemove(connectionId, out _);
        if (_degradedConfirm.TryRemove(connectionId, out var cts))
        {
            cts.Cancel();
            cts.Dispose();
        }
    }

    /// <summary>Down/Error во время ожидания confirm — открыть break сразу с t0 pending Degraded.</summary>
    private async Task FlushDegradedConfirmNowAsync(
        long connectionId, DateTimeOffset atTs, CancellationToken cancellationToken)
    {
        if (!_degradedPending.TryRemove(connectionId, out var pending))
        {
            CancelDegradedConfirm(connectionId);
            return;
        }

        if (_degradedConfirm.TryRemove(connectionId, out var cts))
        {
            cts.Cancel();
            cts.Dispose();
        }

        if (_incidentSince.ContainsKey(connectionId))
        {
            return;
        }

        await ConfirmDegradedIncidentAsync(connectionId, pending.At, pending.Detail, cancellationToken)
            .ConfigureAwait(false);
        // atTs (момент Down) может быть позже pending.At — CloseBreak использует _incidentSince.
        _ = atTs;
    }

    private async Task ConfirmDegradedAfterDelayAsync(long connectionId, CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(DegradedConfirmDelay, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        if (!_degradedPending.TryRemove(connectionId, out var pending))
        {
            return;
        }

        _degradedConfirm.TryRemove(connectionId, out var cts);
        cts?.Dispose();

        if (GetLinkState(connectionId) != ConnectorLinkState.Degraded)
        {
            return;
        }

        if (_incidentSince.ContainsKey(connectionId))
        {
            return;
        }

        await ConfirmDegradedIncidentAsync(connectionId, pending.At, pending.Detail, CancellationToken.None)
            .ConfigureAwait(false);
    }

    private async Task ConfirmDegradedIncidentAsync(
        long connectionId,
        DateTimeOffset openedAt,
        string? detail,
        CancellationToken cancellationToken)
    {
        if (_incidentSince.ContainsKey(connectionId))
        {
            // Adopt без lost-строки (I10): Hub open, а NC/WS пуст — дошлём atom + TRANSAQ progress.
            // Если Open уже был в этой сессии — _transaqProgress крутится, Append не нужен.
            if (!_transaqProgress.ContainsKey(connectionId))
            {
                var adoptedTitle = $"{ConnLabelSystem(connectionId)}: связь потеряна (Degraded)";
                notifications.Append(
                    LinkIncidentSubject(connectionId),
                    "connection.lost",
                    adoptedTitle,
                    severity: "error",
                    data: new
                    {
                        connectionId,
                        state = nameof(ConnectorLinkState.Degraded),
                        detail,
                        sender = "transaq",
                        threadKindHint = NotificationThreadData.KindIncident,
                    },
                    status: "active",
                    ts: openedAt);
                if (!_incidentOwner.ContainsKey(connectionId))
                {
                    _incidentOwner[connectionId] = "transaq";
                }

                if (_incidentOwner.TryGetValue(connectionId, out var owner)
                    && string.Equals(owner, "transaq", StringComparison.Ordinal)
                    && _incidentSince.TryGetValue(connectionId, out var since))
                {
                    StartTransaqRecoverProgress(connectionId, since);
                }
            }

            try
            {
                await ApplyDegradedSideEffectsAsync(connectionId, openedAt, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Подключение {ConnectionId}: side-effects Degraded (уже open)", connectionId);
            }

            return;
        }

        // Сначала Hub.Open (WS), потом память. Label — sync ConnLabelSystem (без БД до lost).
        var title = $"{ConnLabelSystem(connectionId)}: связь потеряна (Degraded)";
        string? corr;
        try
        {
            corr = await FanOutBreakOpenAsync(
                    connectionId,
                    openedAt,
                    owner: "transaq",
                    subtype: "degraded",
                    title,
                    sender: "transaq",
                    state: nameof(ConnectorLinkState.Degraded),
                    detail,
                    cancellationToken)
                .ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Подключение {ConnectionId}: FanOut open break на Degraded провален", connectionId);
            return;
        }

        if (corr is null)
        {
            logger.LogError(
                "Подключение {ConnectionId}: Hub.Open не отправил connection.lost — _incidentSince не ставлю",
                connectionId);
            return;
        }

        if (!_incidentSince.TryAdd(connectionId, openedAt))
        {
            try
            {
                await ApplyDegradedSideEffectsAsync(connectionId, openedAt, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Подключение {ConnectionId}: side-effects после race open", connectionId);
            }

            return;
        }

        _incidentOwner[connectionId] = "transaq";
        RememberOpenCorr(connectionId, corr);
        StartTransaqRecoverProgress(connectionId, openedAt);
        RequestSupervisorNudge?.Invoke();
        logger.LogWarning(
            "Подключение {ConnectionId}: связь Degraded ({Detail}) — инцидент (владелец TRANSAQ), сегменты сохранены",
            connectionId, detail);

        try
        {
            await ApplyDegradedSideEffectsAsync(connectionId, openedAt, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Подключение {ConnectionId}: side-effects после confirm Degraded", connectionId);
        }
    }

    /// <summary>
    /// J5 в Manager: сразу тик «восстановление (TRANSAQ) · 0 с…», далее каждые 5 с; при t≥T — handover.
    /// </summary>
    private void StartTransaqRecoverProgress(long connectionId, DateTimeOffset openedAt)
    {
        StopTransaqRecoverProgress(connectionId);
        var cts = new CancellationTokenSource();
        _transaqProgress[connectionId] = cts;
        _ = RunTransaqRecoverProgressAsync(connectionId, openedAt, cts.Token);
    }

    private void StopTransaqRecoverProgress(long connectionId)
    {
        if (!_transaqProgress.TryRemove(connectionId, out var cts))
        {
            return;
        }

        try
        {
            cts.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // already disposed
        }

        cts.Dispose();
    }

    private async Task RunTransaqRecoverProgressAsync(
        long connectionId, DateTimeOffset openedAt, CancellationToken cancellationToken)
    {
        const int stepSec = 5;
        try
        {
            await EmitTransaqRecoveringTickAsync(connectionId, openedAt, openedAt, cancellationToken)
                .ConfigureAwait(false);

            while (!cancellationToken.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(stepSec), cancellationToken).ConfigureAwait(false);
                // Degraded (server_status / ping-stall grace) или Down при ещё живом owner=transaq.
                var link = GetLinkState(connectionId);
                if (link is not (ConnectorLinkState.Degraded or ConnectorLinkState.Down)
                    || GetIncidentSince(connectionId) is not { } since
                    || !_incidentOwner.TryGetValue(connectionId, out var owner)
                    || !string.Equals(owner, "transaq", StringComparison.Ordinal))
                {
                    return;
                }

                var now = DateTimeOffset.UtcNow;
                var elapsed = now - since;
                if (elapsed >= RecoverGrace)
                {
                    var label = await ResolveLabelAsync(connectionId, cancellationToken).ConfigureAwait(false);
                    var graceSec = (int)RecoverGrace.TotalSeconds;
                    await fanOut
                        .ApplyAsync(
                            new IncidentStep(
                                IncidentStepKind.Recovering,
                                LinkIncidentSubject(connectionId),
                                now,
                                ConnectionId: connectionId,
                                NcCode: "connection.reconnecting",
                                NcMessage:
                                $"{label}: нет восстановления связи (TRANSAQ) за {graceSec} с, передача супервизору",
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
                    await HandoverToSupervisorAsync(connectionId, now, cancellationToken).ConfigureAwait(false);
                    return;
                }

                await EmitTransaqRecoveringTickAsync(connectionId, since, now, cancellationToken)
                    .ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // close / dispose
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Подключение {ConnectionId}: сбой прогресса TRANSAQ recover", connectionId);
        }
    }

    private async Task EmitTransaqRecoveringTickAsync(
        long connectionId,
        DateTimeOffset since,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var label = await ResolveLabelAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var graceSec = (int)RecoverGrace.TotalSeconds;
        const int stepSec = 5;
        var elapsedSec = Math.Max(0, ((int)(now - since).TotalSeconds / stepSec) * stepSec);
        var remainingSec = Math.Max(0, graceSec - elapsedSec);
        await fanOut
            .ApplyAsync(
                new IncidentStep(
                    IncidentStepKind.Recovering,
                    LinkIncidentSubject(connectionId),
                    now,
                    ConnectionId: connectionId,
                    NcCode: "connection.recovering",
                    NcMessage:
                    $"{label}: восстановление связи (TRANSAQ) · {elapsedSec} с, передача супервизору через {remainingSec} с",
                    NcSeverity: "warning",
                    NcData: new
                    {
                        connectionId,
                        owner = "transaq",
                        sender = "supervisor",
                        elapsedSeconds = elapsedSec,
                        handoverInSeconds = remainingSec,
                    }),
                cancellationToken)
            .ConfigureAwait(false);
    }

    private async Task ApplyDegradedSideEffectsAsync(
        long connectionId, DateTimeOffset atTs, CancellationToken cancellationToken)
    {
        if (_sourceIds.TryGetValue(connectionId, out var degradedSourceId))
        {
            await linkLiveness
                .CloseAsync(degradedSourceId, LinkCloseReason.Degraded, atTs, cancellationToken)
                .ConfigureAwait(false);
        }

        await liveness.Value.OnDegradedAsync(connectionId, atTs, cancellationToken).ConfigureAwait(false);
    }

    private async Task OnLinkLiveBestEffortAsync(long connectionId)
    {
        try
        {
            await recordings.Value.OnLinkLiveAsync(connectionId, CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Подключение {ConnectionId}: OnLinkLive (best-effort) провален", connectionId);
        }
    }

    public void Dispose()
    {
        _idleMonitor?.Dispose();
        foreach (var kv in _degradedConfirm)
        {
            kv.Value.Cancel();
            kv.Value.Dispose();
        }

        _degradedConfirm.Clear();
        _degradedPending.Clear();
        foreach (var kv in _transaqProgress)
        {
            kv.Value.Cancel();
            kv.Value.Dispose();
        }

        _transaqProgress.Clear();
    }
}
