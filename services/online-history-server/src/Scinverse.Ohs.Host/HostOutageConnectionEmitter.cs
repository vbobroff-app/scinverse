using System.Text.Json;
using Microsoft.Extensions.Logging;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Слой C (P5.2): один transport crash + scope N enabled connections.
/// Corr <c>ohs.backend.outage:{seed}</c> (без <c>:c{id}</c>); NC — один Thread;
/// journal — 1 строка + <c>incident_connection</c>. Mask/Cutter снаружи.
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

    /// <summary>Legacy per-connection message (до P5.2); emit использует <see cref="OpenMessageBase"/>.</summary>
    public static string MessageFor(long connectionId, string body) =>
        $"Подключение {connectionId}: {body}";

    /// <summary>Transport corr слоя C (P5): без per-connection суффикса.</summary>
    public static string CorrUid(long outageSeed) =>
        $"ohs.backend.outage:{outageSeed}";

    /// <summary>Legacy `:c{id}` — только для чтения старых тестов/hydrate; emit не использует.</summary>
    public static string LegacyCorrUid(long outageSeed, long connectionId) =>
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

        var enabledIds = list.Where(c => c.Enabled).Select(c => c.ConnectionId).Distinct().ToArray();
        if (enabledIds.Length == 0)
        {
            return;
        }

        var corr = CorrUid(result.OutageSeed);

        try
        {
            if (result.OpenedEmitted)
            {
                await EmitOpenAsync(corr, enabledIds, result.OpenedAt, cancellationToken)
                    .ConfigureAwait(false);
            }

            if (result.ClosedEmitted && result.ClosedAt is { } closedAt)
            {
                await EmitCloseAsync(corr, enabledIds, closedAt, cancellationToken)
                    .ConfigureAwait(false);
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "HostOutageConnectionEmitter failed for corr {CorrUid}", corr);
        }
    }

    private Task EmitOpenAsync(
        string corr,
        IReadOnlyList<long> connectionIds,
        DateTimeOffset openedAt,
        CancellationToken cancellationToken)
    {
        var openData = JsonSerializer.SerializeToElement(new
        {
            sender = "client",
            kind = "crash",
            connectionIds,
            threadKindHint = NotificationThreadData.KindIncident,
        });
        hub.Ingest(
            Guid.NewGuid().ToString("N"),
            openedAt,
            CodeUnavailable,
            OpenMessageBase,
            severity: "critical",
            sourceType: "system",
            module: Module,
            data: openData,
            status: "active",
            correlationId: corr);

        return journal.RegisterCrashOpenWithScopeAsync(
            corr, openedAt, connectionIds, OpenMessageBase, cancellationToken);
    }

    private Task EmitCloseAsync(
        string corr,
        IReadOnlyList<long> connectionIds,
        DateTimeOffset closedAt,
        CancellationToken cancellationToken)
    {
        var closeData = JsonSerializer.SerializeToElement(new
        {
            sender = "client",
            kind = "crash",
            connectionIds,
            closeOutcome = NotificationThreadData.OutcomeRecovered,
        });
        hub.Ingest(
            Guid.NewGuid().ToString("N"),
            closedAt,
            CodeRecovered,
            CloseMessageBase,
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
            CloseMessageBase,
            "ok",
            cancellationToken);
    }
}
