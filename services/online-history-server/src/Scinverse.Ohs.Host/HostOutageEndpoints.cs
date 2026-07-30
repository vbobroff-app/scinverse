namespace Scinverse.Ohs.Host;

/// <summary>Crash-dispatch D1: сигнал Host outage (дедуп клиентов). Emit T/C — D2/D3.</summary>
public static class HostOutageEndpoints
{
    public static RouteGroupBuilder MapHostOutageRecovery(this RouteGroupBuilder api)
    {
        api.MapPost("/recovery/outage", (
            HostOutageReportRequest? req,
            HostOutageCoordinator outages) =>
        {
            if (req is null || string.IsNullOrWhiteSpace(req.ClientId))
            {
                return Results.BadRequest(new { error = "clientId обязателен" });
            }

            var result = outages.Report(req.ClientId.Trim(), req.From, req.To, req.Code);
            return Results.Accepted(
                value: new
                {
                    outageSeed = result.OutageSeed,
                    openedAt = result.OpenedAt,
                    closedAt = result.ClosedAt,
                    code = result.Code,
                    isNewEpisode = result.IsNewEpisode,
                    openedEmitted = result.OpenedEmitted,
                    closedEmitted = result.ClosedEmitted,
                    merged = result.Merged,
                    transportCorrUid = $"ohs.host.transport:{result.OutageSeed}",
                });
        });

        return api;
    }
}
