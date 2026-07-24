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
    private static readonly TimeSpan IdleThreshold = TimeSpan.FromSeconds(5);

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
    // Кэш имени подключения для ярлыков NC (7j.18): избегаем DB-lookup на каждое событие связи.
    private readonly ConcurrentDictionary<long, string> _nameCache = new();
    private Timer? _idleMonitor;

    public ConnectorLinkState? GetLinkState(long connectionId) =>
        _linkStates.TryGetValue(connectionId, out var state) ? state : null;

    public string GetStatus(long connectionId) =>
        _status.TryGetValue(connectionId, out var status) ? status : "disconnected";

    /// <summary>Ярлык подключения для NC (7j.18): «Подключение {id} («{name}»)» — id первичен,
    /// имя в кавычках если задано. Единый формат для supervisor/manager.</summary>
    public static string ConnLabel(long connectionId, string? name) =>
        string.IsNullOrWhiteSpace(name)
            ? $"Подключение {connectionId}"
            : $"Подключение {connectionId} («{name}»)";

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

    /// <summary>QUIK-style детали к «связь установлена» отдельными строками (для expanded в NC, 7j.19/I4):
    /// когда было предыдущее подключение (МСК) и как закрылось. Вызывать ДО подключения — иначе «последним»
    /// станет текущий сеанс.</summary>
    public async Task<IReadOnlyList<string>> DescribePreviousConnectionLinesAsync(
        long connectionId, CancellationToken cancellationToken)
    {
        var connection = await connectionStore.GetAsync(connectionId, cancellationToken).ConfigureAwait(false);
        if (connection is null)
        {
            return [];
        }

        var previous = await linkLiveness.GetLastAsync(connection.SourceId, cancellationToken).ConfigureAwait(false);
        return PreviousConnectionLines(previous);
    }

    /// <summary>QUIK-style детали предыдущего подключения строками: «Предыдущее подключение — … МСК» и
    /// «Пред. сеанс — &lt;причина&gt;». Заголовок остаётся чистым, эти строки идут в expanded (data.lines).</summary>
    public static IReadOnlyList<string> PreviousConnectionLines(LinkInterval? previous)
    {
        if (previous is null)
        {
            return ["Первое подключение."];
        }

        var msk = previous.From.ToOffset(TimeSpan.FromHours(3));
        var lines = new List<string>(2) { $"Предыдущее подключение — {msk:dd.MM.yyyy HH:mm} МСК" };
        if (previous.CloseReason is { } r)
        {
            lines.Add($"Пред. сеанс — {LinkCloseReasonText(r)}");
        }

        return lines;
    }

    private static string LinkCloseReasonText(LinkCloseReason reason) => reason switch
    {
        LinkCloseReason.Disconnected => "отключение оператором",
        LinkCloseReason.ServerDown => "обрыв связи",
        LinkCloseReason.PingFailed => "нет ответа",
        LinkCloseReason.Interrupted => "перезапуск",
        LinkCloseReason.Scheduled => "плановое отключение по расписанию",
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
            await session.StartAsync(cancellationToken).ConfigureAwait(false);

            _sessions[connectionId] = session;
            _sourceIds[connectionId] = sourceId;
            connector = null;
            // Подключено, но данных ещё нет → «ожидание» (перейдёт в «active» при первой сделке).
            SetStatus(connectionId, "waiting");
            // Открываем интервал живости связи (лента Connection, 7h.8): связь есть — независимо от записи.
            await linkLiveness
                .HeartbeatAsync(sourceId, DateTimeOffset.UtcNow, LinkMaxGap, cancellationToken)
                .ConfigureAwait(false);
            EnsureIdleMonitor();
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
            case ConnectorLinkState.Degraded:
            {
                // Связь жива: продлеваем/открываем интервал живости связи (лента Connection, 7h.8).
                if (_sourceIds.TryGetValue(connectionId, out var liveSourceId))
                {
                    await linkLiveness
                        .HeartbeatAsync(liveSourceId, change.At, LinkMaxGap, CancellationToken.None)
                        .ConfigureAwait(false);
                }

                var recovering = hadState && previous is ConnectorLinkState.Down or ConnectorLinkState.Error;

                // Закрываем инцидент связи по факту «связь снова жива», опираясь на _incidentSince (не на
                // in-memory previous): реконнект супервизора идёт через полный DisconnectAsync (стирает
                // _linkStates), а стелс-разрыв (ping-fail) вообще без server_status Down — без этого
                // recovered терялся (7j.19/I2). TryRemove делает Resolve однократным и даёт длительность (I3).
                if (_incidentSince.TryRemove(connectionId, out var incidentStart))
                {
                    var label = await ResolveLabelAsync(connectionId, CancellationToken.None).ConfigureAwait(false);
                    var gapMs = (long)(change.At - incidentStart).TotalMilliseconds;
                    notifications.Resolve(
                        LinkIncidentSubject(connectionId),
                        "connection.recovered",
                        $"{label}: связь восстановлена",
                        severity: "ok",
                        data: new
                        {
                            connectionId,
                            state = change.State.ToString(),
                            gapStart = incidentStart,
                            gapEnd = change.At,
                            gapMs,
                            lines = GapDurationLines(incidentStart, change.At),
                        });
                }

                // Ре-подписка нужна только при реальном восстановлении после известного обрыва.
                if (recovering)
                {
                    await recordings.Value.OnLinkLiveAsync(connectionId, CancellationToken.None).ConfigureAwait(false);
                }

                if (change.State == ConnectorLinkState.Degraded)
                {
                    SetStatus(connectionId, StatusForLinkState(change.State));
                }
                else if (recovering || GetStatus(connectionId) is "disconnected" or "error" or "degraded")
                {
                    SetStatus(connectionId, StatusForLinkState(ConnectorLinkState.Live));
                }

                logger.LogInformation(
                    "Подключение {ConnectionId}: связь {State}{Recovering}",
                    connectionId, change.State, recovering ? " (ре-подписка)" : "");
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
                    CancellationToken.None).ConfigureAwait(false);
                break;
            }
        }
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
        CancellationToken cancellationToken)
    {
        _incidentSince.TryAdd(connectionId, atTs);
        notifications.Open(
            LinkIncidentSubject(connectionId),
            "connection.lost",
            message,
            severity: "error",
            data: new { connectionId, state = state.ToString(), detail });

        if (_sourceIds.TryGetValue(connectionId, out var srcId))
        {
            await linkLiveness.CloseAsync(srcId, reason, atTs, cancellationToken).ConfigureAwait(false);
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
            cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Строка длительности разрыва для expanded recovered: «Перерыв HH:MM:SS (from → to МСК)».</summary>
    private static IReadOnlyList<string> GapDurationLines(DateTimeOffset from, DateTimeOffset to)
    {
        var dur = to - from;
        var fromMsk = from.ToOffset(TimeSpan.FromHours(3));
        var toMsk = to.ToOffset(TimeSpan.FromHours(3));
        var hhmmss = $"{(int)dur.TotalHours:00}:{dur.Minutes:00}:{dur.Seconds:00}";
        return [$"Перерыв {hhmmss} ({fromMsk:dd.MM HH:mm:ss} → {toMsk:HH:mm:ss} МСК)"];
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

    /// <summary>Опрос активных сессий: active → waiting, если данных нет дольше <see cref="IdleThreshold"/>.</summary>
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
            if (now - last > IdleThreshold)
            {
                SetStatus(connectionId, "waiting");
            }
        }
    }

    public void Dispose() => _idleMonitor?.Dispose();
}
