using System.Text.Json;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Слой T (crash-dispatch D2): транспортный Group в NC без journal.
/// Corr = <c>ohs.host.transport:{seed}</c>; hint=group; без connectionId.
/// </summary>
public sealed class HostOutageTransportEmitter(NotificationHub hub)
{
    public const string Module = "ohs.host";
    public const string CodeReachable = "host.reachable";
    public const string OpenMessage = "Пропала связь с сервером";
    public const string CloseMessage = "Сервер OHS снова доступен";

    public void Apply(HostOutageReportResult result)
    {
        var corr = $"ohs.host.transport:{result.OutageSeed}";

        if (result.OpenedEmitted)
        {
            var openData = JsonSerializer.SerializeToElement(new
            {
                sender = "client",
                kind = "transport",
                threadKindHint = NotificationThreadData.KindGroup,
            });
            hub.Ingest(
                Guid.NewGuid().ToString("N"),
                result.OpenedAt,
                result.Code,
                OpenMessage,
                severity: "error",
                sourceType: "system",
                module: Module,
                data: openData,
                status: "active",
                correlationId: corr);
        }

        if (result.ClosedEmitted && result.ClosedAt is { } closedAt)
        {
            var closeData = JsonSerializer.SerializeToElement(new
            {
                sender = "client",
                kind = "transport",
                closeOutcome = NotificationThreadData.OutcomeRecovered,
            });
            hub.Ingest(
                Guid.NewGuid().ToString("N"),
                closedAt,
                CodeReachable,
                CloseMessage,
                severity: "ok",
                sourceType: "system",
                module: Module,
                data: closeData,
                status: "resolved",
                correlationId: corr);
        }
    }
}
