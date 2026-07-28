using System.Collections.Concurrent;
using System.Text.Json;
using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>Снимок живого подключения для опроса живости (phase 7h.2).</summary>
public sealed record LiveConnectionSnapshot(long ConnectionId, short SourceId, IMarketConnector Connector);

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
    INotificationPublisher notifications,
    TransaqConnectorOptions transaqDefaults,
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
    // Кэш имени подключения для ярлыков NC (7j.18): избегаем DB-lookup на каждое событие связи.
    private readonly ConcurrentDictionary<long, string> _nameCache = new();
    private Timer? _idleMonitor;

    public ConnectorLinkState? GetLinkState(long connectionId) =>
        _linkStates.TryGetValue(connectionId, out var state) ? state : null;

    /// <summary>Момент открытия текущего инцидента связи (левая граница дыры) или null, если связь в порядке.
    /// Питает прогресс-тик восстановления (7j.20 J5): elapsed = now − since.</summary>
    public DateTimeOffset? GetIncidentSince(long connectionId) =>
        _incidentSince.TryGetValue(connectionId, out var since) ? since : null;

    /// <summary>
    /// Засеять открытый break в память после рестарта (I10): <c>_incidentSince</c>/<c>_incidentOwner</c>
    /// из аудита V025. Без новой NC-строки. false — уже был открытый инцидент в памяти.
    /// </summary>
    public bool AdoptOpenIncident(
        long connectionId, DateTimeOffset since, string owner = "supervisor")
    {
        if (!_incidentSince.TryAdd(connectionId, since))
        {
            return false;
        }

        _incidentOwner[connectionId] = string.IsNullOrWhiteSpace(owner) ? "supervisor" : owner;
        return true;
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

        _incidentOwner[connectionId] = "supervisor";
        notifications.Open(
            LinkIncidentSubject(connectionId),
            "connection.lost",
            $"{label}: не удалось установить связь",
            severity: "error",
            data: new
            {
                connectionId,
                state = "Error",
                sender = "supervisor",
                threadKindHint = NotificationThreadData.KindIncident,
            });
        return true;
    }

    public string GetStatus(long connectionId) =>
        _status.TryGetValue(connectionId, out var status) ? status : "disconnected";

    /// <summary>Ярлык подключения для NC (7j.18): «Подключение {id} («{name}»)» — id первичен,
    /// имя в кавычках если задано. Единый формат для supervisor/manager.</summary>
    public static string ConnLabel(long connectionId, string? name) =>
        string.IsNullOrWhiteSpace(name)
            ? $"Подключение {connectionId}"
            : $"Подключение {connectionId} («{name}»)";

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

    /// <summary>Ярлык подключения с резолвом имени (кэш → БД). Fallback — только id.</summary>
    public async ValueTask<string> ResolveLabelAsync(long connectionId, CancellationToken cancellationToken)
    {
        if (!_nameCache.TryGetValue(connectionId, out var name))
        {
            var connection = await connectionStore.GetAsync(connectionId, cancellationToken).ConfigureAwait(false);
            name = connection?.Name ?? string.Empty;
            if (!string.IsNullOrEmpty(name))
            {
                _nameCache[connectionId] = name;
            }
        }

        return ConnLabel(connectionId, name);
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

    public async Task<string> ConnectAsync(long connectionId, CancellationToken cancellationToken)
    {
        if (_sessions.ContainsKey(connectionId))
        {
            var status = GetStatus(connectionId);
            if (status is "waiting" or "active" or "degraded")
            {
                return status;
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
            // Открываем интервал живости связи (лента Connection, 7h.8): связь есть — независимо от записи.
            await linkLiveness
                .HeartbeatAsync(sourceId, DateTimeOffset.UtcNow, LinkMaxGap, cancellationToken)
                .ConfigureAwait(false);
            EnsureIdleMonitor();
            // 7j.20 J3/J6: успешный (ре)коннект = связь снова жива (server_status connected=true пришёл внутри
            // ConnectAsync). Свежая сессия НЕ даёт отдельного перехода в Live (рождается подключённой), поэтому
            // закрываем открытый инцидент здесь — иначе после handover он висел бы открытым (recovered терялся).
            await CloseIncidentAsync(connectionId, DateTimeOffset.UtcNow, cancellationToken).ConfigureAwait(false);
            // Ре-подписка записей: не полагаемся только на server_status Live (может уже быть consumed /
            // не повториться). OnLinkLiveAsync идемпотентен (пропуск при active coverage).
            await recordings.Value.OnLinkLiveAsync(connectionId, cancellationToken).ConfigureAwait(false);
            _firstTradePending[connectionId] = DateTimeOffset.UtcNow;
            var connectElapsed = System.Diagnostics.Stopwatch.GetElapsedTime(connectStartedAt);
            logger.LogInformation(
                "Подключение {ConnectionId} ({Kind}) установлено за {ElapsedMs:0} мс (рукопожатие TRANSAQ/Finam)",
                connectionId, connection.Kind, connectElapsed.TotalMilliseconds);
            return "waiting";
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
        // Degraded (owner=transaq) → teardown без handover: иначе дыра остаётся вся жёлтой
        // (нет нулевого маркера server_down → нет escalatedAt на ленте).
        if (_incidentSince.ContainsKey(connectionId)
            && _incidentOwner.TryGetValue(connectionId, out var owner)
            && owner == "transaq")
        {
            await TransferBreakOwnerToSupervisorAsync(
                    connectionId, DateTimeOffset.UtcNow, LinkCloseReason.ServerDown, cancellationToken)
                .ConfigureAwait(false);
        }

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

        SetStatus(connectionId, "disconnected");
        return "disconnected";
    }

    /// <summary>
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
        _linkStates[connectionId] = change.State;
        _linkSince[connectionId] = change.At;
        PublishLinkState(connectionId, change);

        switch (change.State)
        {
            case ConnectorLinkState.Live:
            {
                // Связь ЖИВА (server_status connected=true, recover=false): открываем/продлеваем интервал
                // живости связи (лента Connection, 7h.8). Единственное «здоровое» состояние (7j.20).
                if (_sourceIds.TryGetValue(connectionId, out var liveSourceId))
                {
                    await linkLiveness
                        .HeartbeatAsync(liveSourceId, change.At, LinkMaxGap, CancellationToken.None)
                        .ConfigureAwait(false);
                }

                var recovering = hadState && previous is ConnectorLinkState.Down or ConnectorLinkState.Error or ConnectorLinkState.Degraded;

                // Закрываем инцидент связи по факту «связь снова жива» (7j.19/I2, 7j.20 J3): опираемся на
                // _incidentSince, не на in-memory previous (реконнект супервизора идёт через полный
                // DisconnectAsync, стелс-разрыв — без server_status Down). Общий путь с успешным реконнектом
                // супервизора — см. CloseIncidentAsync.
                await CloseIncidentAsync(connectionId, change.At, CancellationToken.None)
                    .ConfigureAwait(false);

                // Ре-подписку НЕЛЬЗЯ гейтить in-memory `recovering` (7j.19/I6): реконнект супервизора идёт
                // через полный DisconnectAsync (стирает _linkStates) → на первом Live новой сессии
                // hadState=false ⇒ recovering=false ⇒ ре-подписка терялась: связь «зелёная» (waiting), но
                // подписок TRANSAQ на новой сессии нет → сделок нет. Для TRANSAQ это ВСЕГДА (восстановление
                // только через новую сессию, server_status Down не приходит). OnLinkLiveAsync идемпотентен
                // (пропускает записи с активным покрытием), поэтому безопасно звать на любом Live/Degraded.
                await recordings.Value.OnLinkLiveAsync(connectionId, CancellationToken.None).ConfigureAwait(false);

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
                // Phase 7j.20: Degraded (server_status connected=true, recover=true) — ИНЦИДЕНТ, а не «живое»
                // состояние: линк к серверу дёрнулся, данных нет, но TRANSAQ сам восстанавливает (владелец
                // восстановления = TRANSAQ). Закрываем интервал живости причиной Degraded → жёлтая дырка на
                // ленте Connection; открываем инцидент связи (error). Сегменты/подписки НЕ рвём (сессия жива,
                // восстановление идёт внутри TRANSAQ) — только идемпотентная ре-подписка. Передача владельца
                // супервизору по grace-таймауту — J3/J6.
                var degradedLabel = await ResolveLabelAsync(connectionId, CancellationToken.None).ConfigureAwait(false);
                _incidentSince.TryAdd(connectionId, change.At);
                _incidentOwner.TryAdd(connectionId, "transaq");
                notifications.Open(
                    LinkIncidentSubject(connectionId),
                    "connection.lost",
                    $"{degradedLabel}: связь потеряна (Degraded)",
                    severity: "error",
                    data: new
                    {
                        connectionId,
                        state = change.State.ToString(),
                        detail = change.Detail,
                        sender = "transaq",
                        threadKindHint = NotificationThreadData.KindIncident,
                    });

                if (_sourceIds.TryGetValue(connectionId, out var degradedSourceId))
                {
                    await linkLiveness
                        .CloseAsync(degradedSourceId, LinkCloseReason.Degraded, change.At, CancellationToken.None)
                        .ConfigureAwait(false);
                }

                await recordings.Value.OnLinkLiveAsync(connectionId, CancellationToken.None).ConfigureAwait(false);
                SetStatus(connectionId, StatusForLinkState(ConnectorLinkState.Degraded));

                logger.LogWarning(
                    "Подключение {ConnectionId}: связь Degraded ({Detail}) — инцидент (владелец TRANSAQ), сегменты сохранены",
                    connectionId, change.Detail);
                break;
            }

            case ConnectorLinkState.Down:
            case ConnectorLinkState.Error:
            {
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
        if (!_incidentSince.TryRemove(connectionId, out incidentStart))
        {
            owner = "supervisor";
            return false;
        }

        owner = _incidentOwner.TryRemove(connectionId, out var incidentOwner) ? incidentOwner : "transaq";
        return true;
    }

    /// <summary>Закрывает открытый инцидент связи (<c>connection.recovered</c>, resolved) на момент
    /// <paramref name="atTs"/>, если он открыт (<c>_incidentSince</c>); иначе no-op. Общий путь для двух
    /// сценариев возврата в Live: тот же сеанс Degraded/Down→Live (self-recovery, из HandleLinkStateAsync) и
    /// успешный реконнект супервизора через НОВУЮ сессию (7j.20 J3/J6) — свежий ConnectAsync не даёт отдельного
    /// перехода в Live (сессия рождается подключённой, server_status connected=true приходит внутри connect),
    /// поэтому без вызова из ConnectAsync инцидент после handover висел бы открытым (recovered терялся). Owner
    /// фиксируем на момент закрытия: "supervisor" (после handover/Down) → «Восстановлено супервизором», иначе TRANSAQ.</summary>
    private async Task CloseIncidentAsync(
        long connectionId, DateTimeOffset atTs, CancellationToken cancellationToken)
    {
        // TryTake + Resolve: Manager и Hub закрываются вместе (I11).
        if (!TryTakeOpenBreak(connectionId, out var incidentStart, out var owner))
        {
            return;
        }

        var label = await ResolveLabelAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var ownerLine = owner == "supervisor"
            ? "Восстановлено супервизором (переподключение)"
            : "Восстановлено TRANSAQ";
        notifications.Resolve(
            LinkIncidentSubject(connectionId),
            "connection.recovered",
            $"{label}: связь восстановлена",
            severity: "ok",
            data: new
            {
                connectionId,
                result = $"{ownerLine}; {FormatGapLine(incidentStart, atTs)}",
                sender = owner,
                closeOutcome = NotificationThreadData.OutcomeRecovered,
            });
    }

    /// <summary>
    /// Закрывает открытый <c>break</c>-инцидент по окончании окна расписания (desired true→false):
    /// NC <c>connection.incident_closed</c> · warning · resolved; лента — маркер <c>scheduled</c>
    /// (край дырки, <c>Abandoned</c>, без green). Идемпотентно: нет открытого инцидента → false.
    /// </summary>
    public async Task<bool> TryAbandonIncidentByScheduleAsync(
        long connectionId, DateTimeOffset atTs, CancellationToken cancellationToken)
    {
        if (!TryTakeOpenBreak(connectionId, out var incidentStart, out _))
        {
            return false;
        }

        var sourceId = await ResolveSourceIdAsync(connectionId, cancellationToken).ConfigureAwait(false);
        if (sourceId is { } sid)
        {
            await linkLiveness
                .InsertBoundaryMarkerAsync(sid, LinkCloseReason.Scheduled, atTs, cancellationToken)
                .ConfigureAwait(false);
        }

        var label = await ResolveLabelAsync(connectionId, cancellationToken).ConfigureAwait(false);
        notifications.Resolve(
            LinkIncidentSubject(connectionId),
            "connection.incident_closed",
            $"{label}: инцидент закрыт по окончании окна расписания",
            severity: "warning",
            data: new
            {
                connectionId,
                kind = "break",
                reason = "schedule_end",
                sender = "supervisor",
                result = $"Закрыто по окончании окна расписания; {FormatGapLine(incidentStart, atTs)}",
                closeOutcome = NotificationThreadData.OutcomeAbandonedSchedule,
            });

        logger.LogInformation(
            "Подключение {ConnectionId}: break-инцидент закрыт по окончании окна расписания (с {Start:o} по {End:o})",
            connectionId, incidentStart, atTs);
        return true;
    }

    /// <summary>
    /// J11b / I11 B1: ручной off тумблера при открытом break — Manager+Hub вместе,
    /// <c>closeOutcome=abandoned_manual</c>, маркер ленты <c>disconnected</c> (без green).
    /// Нет open break → false (лишней NC-строки нет).
    /// </summary>
    public async Task<bool> TryAbandonIncidentByManualAsync(
        long connectionId, DateTimeOffset atTs, CancellationToken cancellationToken)
    {
        if (!TryTakeOpenBreak(connectionId, out var incidentStart, out _))
        {
            return false;
        }

        var sourceId = await ResolveSourceIdAsync(connectionId, cancellationToken).ConfigureAwait(false);
        if (sourceId is { } sid)
        {
            await linkLiveness
                .InsertBoundaryMarkerAsync(sid, LinkCloseReason.Disconnected, atTs, cancellationToken)
                .ConfigureAwait(false);
        }

        var label = await ResolveLabelAsync(connectionId, cancellationToken).ConfigureAwait(false);
        notifications.Resolve(
            LinkIncidentSubject(connectionId),
            "connection.incident_closed",
            $"{label}: инцидент закрыт (отключено оператором)",
            severity: "warning",
            data: new
            {
                connectionId,
                kind = "break",
                reason = "manual_off",
                sender = "user",
                result = $"Закрыто оператором; {FormatGapLine(incidentStart, atTs)}",
                closeOutcome = NotificationThreadData.OutcomeAbandonedManual,
            });

        logger.LogInformation(
            "Подключение {ConnectionId}: break-инцидент закрыт вручную (с {Start:o} по {End:o})",
            connectionId, incidentStart, atTs);
        return true;
    }

    /// <summary>
    /// Клиент закрыл crash по schedule_end (mock-POST): маркер <c>scheduled</c> на ленте —
    /// клип штриховки без green (<c>Abandoned</c>). Не трогает NC (уже ingest'нут).
    /// </summary>
    public async Task MarkCrashAbandonedByScheduleAsync(
        long connectionId, DateTimeOffset atTs, CancellationToken cancellationToken)
    {
        var sourceId = await ResolveSourceIdAsync(connectionId, cancellationToken).ConfigureAwait(false);
        if (sourceId is { } sid)
        {
            await linkLiveness
                .InsertBoundaryMarkerAsync(sid, LinkCloseReason.Scheduled, atTs, cancellationToken)
                .ConfigureAwait(false);
        }
    }

    private async Task<short?> ResolveSourceIdAsync(long connectionId, CancellationToken cancellationToken)
    {
        if (_sourceIds.TryGetValue(connectionId, out var liveSourceId))
        {
            return liveSourceId;
        }

        var connection = await connectionStore.GetAsync(connectionId, cancellationToken).ConfigureAwait(false);
        return connection?.SourceId;
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
        CancellationToken cancellationToken)
    {
        var subject = LinkIncidentSubject(connectionId);
        var isNew = _incidentSince.TryAdd(connectionId, atTs);
        // Host открывает break только пока сессия жива (= горизонт desired) → Incident.
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
            // Сразу Down/Error/ping — owner=supervisor с t0 (жёлтой фазы не было).
            _incidentOwner[connectionId] = "supervisor";
            notifications.Open(subject, "connection.lost", message, severity: "error", data: lostData);
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
            notifications.Append(subject, "connection.lost", message, severity: "error", data: lostData);
            await TransferBreakOwnerToSupervisorAsync(connectionId, atTs, reason, cancellationToken)
                .ConfigureAwait(false);
        }

        await liveness.Value.OnServerDownAsync(connectionId, atTs, cancellationToken).ConfigureAwait(false);
        await recordings.Value.OnLinkDownAsync(connectionId, segmentStatus, atTs, cancellationToken).ConfigureAwait(false);
        SetStatus(connectionId, StatusForLinkState(state));
    }

    /// <summary>
    /// Стелс-разрыв данных (7j.19/I3): тишина сделок дольше порога + активный пинг НЕ прошёл ⇒ связь мертва,
    /// хотя коннектор ещё считает себя connected (server_status Down не пришёл). Фиксируем инцидент с началом
    /// = последняя сделка (<paramref name="lastActivityAt"/>) — честная левая граница дыры. Дедуп: если
    /// инцидент уже открыт или статус уже «вниз» — тихо выходим (тик 15 c не должен спамить). Восстановление
    /// придёт штатно через Live новой сессии (реконнект супервизора) → recovered с длительностью.
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

        _linkStates[connectionId] = ConnectorLinkState.Down;
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
            ConnectorLinkState.Down,
            "нет данных: активный пинг не прошёл",
            sender: "supervisor",
            cancellationToken).ConfigureAwait(false);
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

    public void Dispose() => _idleMonitor?.Dispose();
}
