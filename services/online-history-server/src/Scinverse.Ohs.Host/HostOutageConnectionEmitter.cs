using System.Text.Json;
using Microsoft.Extensions.Logging;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Слой C (crash-dispatch / schedule-as-projection P3): ∀ enabled connection —
/// NC Incident + journal с fixed corr <c>ohs.backend.outage:{seed}:c{id}</c>.
/// Расписание не классифицирует (mask/Cutter снаружи).
/// </summary>
public sealed class HostOutageConnectionEmitter(
    IConnectionStore connections,
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
                var corr = CorrUid(result.OutageSeed, connection.ConnectionId);

                if (result.OpenedEmitted)
                {
                    await EmitOpenAsync(connection.ConnectionId, corr, result.OpenedAt, cancellationToken)
                        .ConfigureAwait(false);
                }

                if (result.ClosedEmitted && result.ClosedAt is { } closedAt)
                {
                    await EmitCloseAsync(connection.ConnectionId, corr, closedAt, cancellationToken)
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
        DateTimeOffset openedAt,
        CancellationToken cancellationToken)
    {
        var openData = JsonSerializer.SerializeToElement(new
        {
            sender = "client",
            kind = "crash",
            connectionId,
            threadKindHint = NotificationThreadData.KindIncident,
        });
        var openMessage = MessageFor(connectionId, OpenMessageBase);
        hub.Ingest(
            Guid.NewGuid().ToString("N"),
            openedAt,
            CodeUnavailable,
            openMessage,
            severity: "critical",
            sourceType: "system",
            module: Module,
            data: openData,
            status: "active",
            correlationId: corr);

        return journal.RegisterCrashOpenAsync(
            corr, openedAt, connectionId, openMessage, cancellationToken);
    }

    private Task EmitCloseAsync(
        long connectionId,
        string corr,
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

        return journal.RegisterBreakResolvedAsync(
            corr,
            closedAt,
            NotificationThreadData.OutcomeRecovered,
            closeMessage,
            "ok",
            cancellationToken);
    }
}
