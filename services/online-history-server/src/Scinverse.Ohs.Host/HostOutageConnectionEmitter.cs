using System.Text.Json;
using Microsoft.Extensions.Logging;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Domain.Moex;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Слой C (crash-dispatch D3): ∀ enabled connection — NC с fixed corr
/// <c>ohs.backend.outage:{seed}:c{id}</c>; journal только при desired (Incident).
/// </summary>
public sealed class HostOutageConnectionEmitter(
    IConnectionStore connections,
    IConnectionScheduleStore schedules,
    IMarketCalendar calendar,
    NotificationHub hub,
    IJournalRegistrator journal,
    ILogger<HostOutageConnectionEmitter> logger)
{
    public const string Module = "ohs.host";
    public const string CodeUnavailable = "backend.unavailable";
    public const string CodeRecovered = "backend.recovered";
    public const string OpenMessageBase = "Сервер OHS недоступен, жду восстановления";
    public const string CloseMessageBase = "Система восстановлена";

    /// <summary>Текст Entry/журнала с привязкой к connection (иначе N нитей выглядят как дубль).</summary>
    public static string MessageFor(long connectionId, string body) =>
        $"Подключение {connectionId}: {body}";

    public static string CorrUid(long outageSeed, long connectionId) =>
        $"ohs.backend.outage:{outageSeed}:c{connectionId}";

    public async Task ApplyAsync(HostOutageReportResult result, CancellationToken cancellationToken = default)
    {
        if (!result.OpenedEmitted && !result.ClosedEmitted)
        {
            return;
        }

        IReadOnlyList<ConnectorConnection> list;
        try
        {
            list = await connections.ListAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "HostOutageConnectionEmitter: ListAsync failed");
            return;
        }

        foreach (var connection in list)
        {
            if (!connection.Enabled)
            {
                continue;
            }

            try
            {
                // Классификация нити эпизода — по openedAt (как на Open); close той же нити.
                var desired = await IsDesiredAsync(connection.ConnectionId, result.OpenedAt, cancellationToken)
                    .ConfigureAwait(false);
                var corr = CorrUid(result.OutageSeed, connection.ConnectionId);
                var hint = desired
                    ? NotificationThreadData.KindIncident
                    : NotificationThreadData.KindGroup;

                if (result.OpenedEmitted)
                {
                    await EmitOpenAsync(connection.ConnectionId, corr, hint, desired, result.OpenedAt, cancellationToken)
                        .ConfigureAwait(false);
                }

                if (result.ClosedEmitted && result.ClosedAt is { } closedAt)
                {
                    await EmitCloseAsync(connection.ConnectionId, corr, desired, closedAt, cancellationToken)
                        .ConfigureAwait(false);
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(
                    ex,
                    "HostOutageConnectionEmitter failed for connection {ConnectionId}",
                    connection.ConnectionId);
            }
        }
    }

    private Task EmitOpenAsync(
        long connectionId,
        string corr,
        string hint,
        bool desired,
        DateTimeOffset openedAt,
        CancellationToken cancellationToken)
    {
        var openData = JsonSerializer.SerializeToElement(new
        {
            sender = "client",
            kind = "crash",
            connectionId,
            threadKindHint = hint,
        });
        var openMessage = MessageFor(connectionId, OpenMessageBase);
        hub.Ingest(
            Guid.NewGuid().ToString("N"),
            openedAt,
            CodeUnavailable,
            openMessage,
            severity: desired ? "critical" : "error",
            sourceType: "system",
            module: Module,
            data: openData,
            status: "active",
            correlationId: corr);

        if (!desired)
        {
            return Task.CompletedTask;
        }

        return journal.RegisterCrashOpenAsync(
            corr, openedAt, connectionId, openMessage, cancellationToken);
    }

    private Task EmitCloseAsync(
        long connectionId,
        string corr,
        bool wasIncident,
        DateTimeOffset closedAt,
        CancellationToken cancellationToken)
    {
        var closeData = JsonSerializer.SerializeToElement(new
        {
            sender = "client",
            kind = "crash",
            connectionId,
            closeOutcome = NotificationThreadData.OutcomeRecovered,
        });
        var closeMessage = MessageFor(connectionId, CloseMessageBase);
        hub.Ingest(
            Guid.NewGuid().ToString("N"),
            closedAt,
            CodeRecovered,
            closeMessage,
            severity: "ok",
            sourceType: "system",
            module: Module,
            data: closeData,
            status: "resolved",
            correlationId: corr);

        if (!wasIncident)
        {
            return Task.CompletedTask;
        }

        return journal.RegisterBreakResolvedAsync(
            corr,
            closedAt,
            NotificationThreadData.OutcomeRecovered,
            closeMessage,
            "ok",
            cancellationToken);
    }

    /// <summary>Тот же desired, что у Auto/break: schedule + trading day календаря.</summary>
    private async Task<bool> IsDesiredAsync(
        long connectionId, DateTimeOffset atUtc, CancellationToken cancellationToken)
    {
        var state = await schedules.GetStateAsync(connectionId, cancellationToken).ConfigureAwait(false);
        if (state.LiveRules.Count == 0)
        {
            return false;
        }

        var settings = state.Settings;
        var local = ToLocal(atUtc, settings.Tz);
        var localTime = TimeOnly.FromDateTime(local.DateTime);
        var localDate = DateOnly.FromDateTime(local.DateTime);
        var tradingByDay = new Dictionary<DateOnly, bool>();
        foreach (var openDay in new[] { localDate.AddDays(-1), localDate })
        {
            var sessions = await calendar
                .ShapeSessionsAsync(settings.Engine, [openDay], cancellationToken)
                .ConfigureAwait(false);
            tradingByDay[openDay] = sessions.Count > 0;
        }

        return ConnectionScheduleResolver.IsConnectDesired(
            state.LiveRules,
            settings.Engine,
            localDate,
            localTime,
            (_, day) => tradingByDay.GetValueOrDefault(day));
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
            return TimeZoneInfo.ConvertTime(utc, zone);
        }
        catch (TimeZoneNotFoundException)
        {
            return utc.ToOffset(MoexSchedule.MoscowOffset);
        }
        catch (InvalidTimeZoneException)
        {
            return utc.ToOffset(MoexSchedule.MoscowOffset);
        }
    }
}
