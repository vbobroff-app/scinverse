using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Писатель живости захвата (phase 7h.2): тик 15 c, хартбит по сделкам/свежим данным, активный пинг в
/// сессионной тишине, закрытие к концу торговой сессии и при стопе/дисконнекте.
/// </summary>
public sealed class LivenessProbe(
    ConnectionManager connections,
    RecordingManager recordings,
    ICaptureLivenessStore liveness,
    ILinkLivenessStore linkLiveness,
    IMarketCalendar calendar,
    OhsOptions options,
    TimeProvider time,
    ILogger<LivenessProbe> logger) : ILivenessWriter
{
    /// <summary>Движок MOEX для гейта торговых часов (фьючерсы/опционы FORTS).</summary>
    private const string FuturesEngine = "futures";

    private readonly TimeSpan _probeInterval = TimeSpan.FromSeconds(
        options.LivenessProbeSeconds > 0 ? options.LivenessProbeSeconds : 15);

    private DateOnly _sessionCacheDate;
    private TradingSession? _sessionCache;

    private TimeSpan MaxGap => TimeSpan.FromSeconds(Math.Max(_probeInterval.TotalSeconds * 3, 45));

    public Task OnDataAsync(long connectionId, CancellationToken cancellationToken)
    {
        // H1: в Degraded сделки/колбэки не продлевают «честную» подложку захвата.
        if (connections.GetLinkState(connectionId) == ConnectorLinkState.Degraded)
        {
            return Task.CompletedTask;
        }

        return HeartbeatIfRecordingAsync(connectionId, time.GetUtcNow(), cancellationToken);
    }

    public async Task OnRecordingStoppedAsync(long connectionId, CancellationToken cancellationToken)
    {
        if (recordings.HasRecordingsOnConnection(connectionId))
        {
            return;
        }

        await CloseIfOpenAsync(connectionId, CaptureCloseReason.Stopped, null, cancellationToken).ConfigureAwait(false);
    }

    public Task OnDisconnectedAsync(long connectionId, CancellationToken cancellationToken) =>
        CloseIfOpenAsync(connectionId, CaptureCloseReason.Stopped, null, cancellationToken);

    public Task OnServerDownAsync(long connectionId, DateTimeOffset at, CancellationToken cancellationToken) =>
        CloseIfOpenAsync(connectionId, CaptureCloseReason.ServerDown, at, cancellationToken);

    public Task OnDegradedAsync(long connectionId, DateTimeOffset at, CancellationToken cancellationToken) =>
        CloseIfOpenAsync(connectionId, CaptureCloseReason.ServerDown, at, cancellationToken);

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(_probeInterval);
        while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
        {
            try
            {
                await TickAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Ошибка тика живости захвата");
            }
        }
    }

    private async Task TickAsync(CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        foreach (var session in connections.ListSessions())
        {
            // Keepalive живости СВЯЗИ (лента Connection, 7h.8): двигаем to_ts БЕЗ пинга и БЕЗ гейта записи/
            // сессии, пока связь ЖИВА. Гейтим по Live (7j.20): в Degraded интервал уже закрыт причиной
            // 'degraded' в HandleLinkStateAsync (жёлтая дырка) — keepalive НЕ должен его переоткрывать.
            // null (первый connect до первого server_status) считаем живым: интервал уже открыт ConnectAsync.
            var linkState = connections.GetLinkState(session.ConnectionId);
            if (session.Connector.IsConnected && linkState is null or ConnectorLinkState.Live)
            {
                await linkLiveness.HeartbeatAsync(session.SourceId, now, MaxGap, cancellationToken)
                    .ConfigureAwait(false);
            }

            if (!recordings.HasRecordingsOnConnection(session.ConnectionId))
            {
                // Stall/ping watchdog только при активной записи — без неё ждём server_status от DLL.
                if (session.Connector.IsConnected
                    && linkState is null or ConnectorLinkState.Live
                    && connections.GetLastData(session.ConnectionId) is { } idleAt
                    && now - idleAt > _probeInterval)
                {
                    logger.LogDebug(
                        "LinkDetect: no-recording skip stall conn={ConnectionId} silent={SilentSec:0.#}s " +
                        "(ждём server_status)",
                        session.ConnectionId, (now - idleAt).TotalSeconds);
                }

                continue;
            }

            // H1: Degraded = дыра записи — не хартбитим capture; закрываем, если интервал ещё open
            // (гонка с OnDegradedAsync / рестарт mid-Degraded).
            if (linkState == ConnectorLinkState.Degraded)
            {
                await CloseIfOpenAsync(
                        session.ConnectionId, CaptureCloseReason.ServerDown, now, cancellationToken)
                    .ConfigureAwait(false);
                continue;
            }

            var sessionInfo = await ResolveTradingSessionAsync(now, cancellationToken).ConfigureAwait(false);
            if (sessionInfo is null)
            {
                // Праздник/неторговый день — не пингуем, интервал не продлеваем.
                continue;
            }

            if (now > sessionInfo.End)
            {
                await CloseIfOpenAsync(
                    session.ConnectionId, CaptureCloseReason.Stopped, sessionInfo.End, cancellationToken)
                    .ConfigureAwait(false);
                continue;
            }

            if (now < sessionInfo.Start)
            {
                // До открытия сессии — тишина законна, пинг не нужен.
                continue;
            }

            var lastData = connections.GetLastData(session.ConnectionId);
            var silentSec = lastData is { } ld ? (now - ld).TotalSeconds : double.PositiveInfinity;
            var dataFresh = lastData is not null && silentSec <= _probeInterval.TotalSeconds;

            if (dataFresh)
            {
                await HeartbeatAsync(session.SourceId, now, cancellationToken).ConfigureAwait(false);
                continue;
            }

            // Сессионная тишина — активный пинг (страховка «тихой смерти» DLL).
            if (!session.Connector.IsConnected)
            {
                logger.LogWarning(
                    "LinkDetect: stall-tick conn={ConnectionId} silent={SilentSec:0.#}s IsConnected=false → PingFailed",
                    session.ConnectionId, silentSec);
                await CloseIfOpenAsync(
                    session.ConnectionId, CaptureCloseReason.PingFailed, now, cancellationToken)
                    .ConfigureAwait(false);
                continue;
            }

            var probeStarted = time.GetUtcNow();
            var pingOk = await ProbeAsync(session.Connector, cancellationToken).ConfigureAwait(false);
            var probeMs = (time.GetUtcNow() - probeStarted).TotalMilliseconds;
            // Transaq: get_servtime_difference с ProbeTimeoutSeconds (дефолт 3 с).
            // Без таймаута SendCommand на обрыве кабеля висит ~20–50 с и может вернуть
            // stale success — UI тогда ждёт только server_status (~20 с). VPN рвёт сразу.
            logger.LogWarning(
                "LinkDetect: stall-tick conn={ConnectionId} silent={SilentSec:0.#}s link={Link} " +
                "IsConnected={Connected} pingOk={PingOk} probeMs={ProbeMs:0} " +
                "incidentOpen={Incident}",
                session.ConnectionId,
                silentSec,
                linkState?.ToString() ?? "null",
                session.Connector.IsConnected,
                pingOk,
                probeMs,
                connections.GetIncidentSince(session.ConnectionId) is not null);

            if (pingOk)
            {
                await HeartbeatAsync(session.SourceId, now, cancellationToken).ConfigureAwait(false);
            }
            else
            {
                logger.LogWarning(
                    "LinkDetect: ping FAIL conn={ConnectionId} ({Source}) — ReportStall + close capture",
                    session.ConnectionId, session.Connector.SourceCode);
                await CloseIfOpenAsync(
                    session.ConnectionId, CaptureCloseReason.PingFailed, now, cancellationToken)
                    .ConfigureAwait(false);

                // 7j.19/I3: тишина сделок > порога + пинг не прошёл = подтверждённый разрыв данных, хотя
                // server_status Down мог не прийти. Фиксируем инцидент связи с началом = последняя сделка
                // (честная граница дыры). Восстановление придёт через Live новой сессии (реконнект).
                if (lastData is { } lastTradeAt)
                {
                    await connections.ReportStallAsync(session.ConnectionId, lastTradeAt, cancellationToken)
                        .ConfigureAwait(false);
                }
            }
        }
    }

    private async Task HeartbeatIfRecordingAsync(
        long connectionId, DateTimeOffset ts, CancellationToken cancellationToken)
    {
        if (!connections.TryGetSourceId(connectionId, out var sourceId))
        {
            return;
        }

        if (!recordings.HasRecordingsOnConnection(connectionId))
        {
            return;
        }

        var sessionInfo = await ResolveTradingSessionAsync(ts, cancellationToken).ConfigureAwait(false);
        if (sessionInfo is null || ts < sessionInfo.Start || ts > sessionInfo.End)
        {
            return;
        }

        await HeartbeatAsync(sourceId, ts, cancellationToken).ConfigureAwait(false);
    }

    private async Task HeartbeatAsync(short sourceId, DateTimeOffset ts, CancellationToken cancellationToken) =>
        await liveness.HeartbeatAsync(sourceId, ts, MaxGap, cancellationToken).ConfigureAwait(false);

    private async Task CloseIfOpenAsync(
        long connectionId, CaptureCloseReason reason, DateTimeOffset? atTs, CancellationToken cancellationToken)
    {
        if (!connections.TryGetSourceId(connectionId, out var sourceId))
        {
            return;
        }

        await liveness.CloseAsync(sourceId, reason, atTs, cancellationToken).ConfigureAwait(false);
    }

    private async Task<TradingSession?> ResolveTradingSessionAsync(
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var moscow = now.ToOffset(MoexSchedule.MoscowOffset);
        var date = DateOnly.FromDateTime(moscow.DateTime);

        if (_sessionCacheDate != date)
        {
            var sessions = await calendar
                .ShapeSessionsAsync(FuturesEngine, [date], cancellationToken)
                .ConfigureAwait(false);
            _sessionCache = sessions.Count > 0 ? sessions[0] : null;
            _sessionCacheDate = date;
        }

        return _sessionCache;
    }

    private static Task<bool> ProbeAsync(IMarketConnector connector, CancellationToken cancellationToken) =>
        connector.ProbeConnectionAsync(cancellationToken);
}
