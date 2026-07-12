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
    TransaqConnectorOptions transaqDefaults,
    ILoggerFactory loggerFactory,
    ILogger<ConnectionManager> logger) : IDisposable
{
    /// <summary>Порог тишины: нет данных от коннектора дольше — статус «ожидание» (waiting).</summary>
    private static readonly TimeSpan IdleThreshold = TimeSpan.FromSeconds(5);

    private readonly ConcurrentDictionary<long, ConnectorSession> _sessions = new();
    private readonly ConcurrentDictionary<long, short> _sourceIds = new();
    private readonly ConcurrentDictionary<long, string> _status = new();
    private readonly ConcurrentDictionary<long, DateTimeOffset> _lastData = new();
    private Timer? _idleMonitor;

    public string GetStatus(long connectionId) =>
        _status.TryGetValue(connectionId, out var status) ? status : "disconnected";

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
            return GetStatus(connectionId);
        }

        var connection = await connectionStore.GetAsync(connectionId, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException($"Подключение {connectionId} не найдено");

        var creds = ResolveCredentials(connectionId, connection.Kind);

        using var settings = JsonDocument.Parse(string.IsNullOrWhiteSpace(connection.Settings) ? "{}" : connection.Settings);
        var connector = factory.Create(connection.Kind, settings.RootElement, creds);

        await connector.ConnectAsync(cancellationToken).ConfigureAwait(false);

        var sourceId = await sourceStore.ResolveIdAsync(connector.SourceCode, cancellationToken).ConfigureAwait(false);

        var session = new ConnectorSession(
            connector, parser, registry, sourceStore, normalizer, batcher, coverageTracker,
            loggerFactory.CreateLogger<ConnectorSession>(),
            onData: () => ReportActivity(connectionId),
            onLinkState: change => HandleLinkState(connectionId, change));
        await session.StartAsync(cancellationToken).ConfigureAwait(false);

        _sessions[connectionId] = session;
        _sourceIds[connectionId] = sourceId;
        // Подключено, но данных ещё нет → «ожидание» (перейдёт в «active» при первой сделке).
        SetStatus(connectionId, "waiting");
        EnsureIdleMonitor();
        logger.LogInformation("Подключение {ConnectionId} ({Kind}) установлено", connectionId, connection.Kind);
        return "waiting";
    }

    /// <summary>Отмечает поступление данных от коннектора: waiting → active (idle-монитор вернёт назад).</summary>
    public void ReportActivity(long connectionId)
    {
        _lastData[connectionId] = DateTimeOffset.UtcNow;
        if (GetStatus(connectionId) == "waiting")
        {
            SetStatus(connectionId, "active");
        }

        _ = liveness.Value.OnDataAsync(connectionId, CancellationToken.None);
    }

    public async Task<string> DisconnectAsync(long connectionId, CancellationToken cancellationToken)
    {
        if (_sessions.TryRemove(connectionId, out var session))
        {
            await session.StopAsync().ConfigureAwait(false);
        }

        _sourceIds.TryRemove(connectionId, out _);
        _lastData.TryRemove(connectionId, out _);
        await liveness.Value.OnDisconnectedAsync(connectionId, cancellationToken).ConfigureAwait(false);
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

    public async Task StopAllAsync(CancellationToken cancellationToken)
    {
        foreach (var connectionId in _sessions.Keys)
        {
            await DisconnectAsync(connectionId, cancellationToken).ConfigureAwait(false);
        }
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

    /// <summary>Реакция на <c>server_status</c> от коннектора (phase 7h.3); полный автомат — 7h.4.</summary>
    private void HandleLinkState(long connectionId, ConnectorLinkStateChange change)
    {
        switch (change.State)
        {
            case ConnectorLinkState.Live:
            case ConnectorLinkState.Degraded:
                if (GetStatus(connectionId) is "disconnected" or "error")
                {
                    SetStatus(connectionId, "waiting");
                }

                logger.LogInformation(
                    "Подключение {ConnectionId}: связь {State}",
                    connectionId, change.State);
                break;

            case ConnectorLinkState.Down:
            case ConnectorLinkState.Error:
                logger.LogWarning(
                    "Подключение {ConnectionId}: связь {State} ({Detail})",
                    connectionId, change.State, change.Detail);
                _ = liveness.Value.OnServerDownAsync(connectionId, change.At, CancellationToken.None);
                SetStatus(connectionId, "disconnected");
                break;
        }
    }

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
