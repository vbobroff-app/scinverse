namespace Scinverse.Ohs.Host;

/// <summary>Crash-dispatch: сигнал Host outage (дедуп клиентов) + emit слоёв T/C.</summary>
public static class HostOutageEndpoints
{
    public static RouteGroupBuilder MapHostOutageRecovery(this RouteGroupBuilder api)
    {
        api.MapPost("/recovery/outage", async (
            HostOutageReportRequest? req,
            HostOutageCoordinator outages,
            HostOutageTransportEmitter transport,
            HostOutageConnectionEmitter connections,
            CancellationToken ct) =>
        {
            if (req is null || string.IsNullOrWhiteSpace(req.ClientId))
            {
                return Results.BadRequest(new { error = "clientId обязателен" });
            }

            var result = outages.Report(req.ClientId.Trim(), req.From, req.To, req.Code);
            // D2: слой T в NC (без journal). D3: слой C per enabled connection.
            transport.Apply(result);
            await connections.ApplyAsync(result, ct).ConfigureAwait(false);
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
