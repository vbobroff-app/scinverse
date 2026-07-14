using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Полуавтомат записи (phase 7i): для Auto-инструментов в сессии MOEX поднимает связь и запись,
/// вне сессии — стопает запись, Auto не снимает. Ручной Стоп снимает Auto отдельно (API).
/// </summary>
public sealed class RecordingSupervisor(
    IRecordingScheduleStore schedule,
    RecordingManager recordings,
    ConnectionManager connections,
    IMarketCalendar calendar,
    TimeProvider time,
    WebSocketBroadcaster broadcaster,
    ILogger<RecordingSupervisor> logger)
{
    private const string FuturesEngine = "futures";
    private static readonly TimeSpan TickInterval = TimeSpan.FromSeconds(30);

    private readonly SemaphoreSlim _wake = new(0, 1);

    private DateOnly _sessionCacheDate;
    private TradingSession? _sessionCache;

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
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await ReconcileAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Ошибка тика RecordingSupervisor");
            }

            var delay = Task.Delay(TickInterval, cancellationToken);
            var wake = _wake.WaitAsync(cancellationToken);
            await Task.WhenAny(delay, wake).ConfigureAwait(false);
        }
    }

    private async Task ReconcileAsync(CancellationToken cancellationToken)
    {
        var entries = await schedule.ListEnabledAsync(cancellationToken).ConfigureAwait(false);
        if (entries.Count == 0)
        {
            return;
        }

        var now = time.GetUtcNow();
        var session = await ResolveTradingSessionAsync(now, cancellationToken).ConfigureAwait(false);
        var inSession = session is not null && now >= session.Start && now <= session.End;

        foreach (var entry in entries)
        {
            try
            {
                if (inSession)
                {
                    await ArmAsync(entry, cancellationToken).ConfigureAwait(false);
                }
                else
                {
                    await DisarmAsync(entry, cancellationToken).ConfigureAwait(false);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(
                    ex,
                    "Supervisor: не удалось согласовать Auto для инструмента {InstrumentId}",
                    entry.InstrumentId);
            }
        }
    }

    private async Task ArmAsync(RecordingScheduleEntry entry, CancellationToken cancellationToken)
    {
        // Полуавтомат: связь поднимает пользователь (тумблер провайдера). Supervisor НЕ вызывает
        // ConnectAsync — TRANSAQ процесс-глобален (одно соединение на процесс), фоновый connect
        // рассинхронит DLL и менеджер. Нет связи → жёлтый «жду связи», запись не вооружаем.
        if (connections.GetConnector(entry.ConnectionId) is null)
        {
            return;
        }

        if (recordings.IsRecording(entry.InstrumentId))
        {
            return;
        }

        await recordings.StartAsync(entry.InstrumentId, entry.ConnectionId, cancellationToken)
            .ConfigureAwait(false);
        logger.LogInformation(
            "Supervisor: Auto-старт записи {InstrumentId} через {ConnectionId}",
            entry.InstrumentId, entry.ConnectionId);
    }

    private async Task DisarmAsync(RecordingScheduleEntry entry, CancellationToken cancellationToken)
    {
        if (!recordings.IsRecording(entry.InstrumentId))
        {
            return;
        }

        await recordings.StopAsync(entry.InstrumentId, cancellationToken).ConfigureAwait(false);
        logger.LogInformation(
            "Supervisor: Auto-стоп записи {InstrumentId} (вне сессии MOEX)",
            entry.InstrumentId);
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

    /// <summary>Широковещает актуальный снимок расписания (после PUT / ручного стопа).</summary>
    public async Task BroadcastScheduleAsync(CancellationToken cancellationToken)
    {
        var all = await schedule.ListAsync(cancellationToken).ConfigureAwait(false);
        broadcaster.Broadcast(new RecordingScheduleChangedEvent(
            all.Select(e => new RecordingScheduleItem(e.InstrumentId, e.ConnectionId, e.AutoEnabled)).ToList()));
    }
}
