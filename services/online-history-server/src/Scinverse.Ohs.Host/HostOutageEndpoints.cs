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
            ClientRecoveryGate recoveryGate,
            CancellationToken ct) =>
        {
            if (req is null || string.IsNullOrWhiteSpace(req.ClientId))
            {
                return Results.BadRequest(new { error = "clientId обязателен" });
            }

            var result = outages.Report(req.ClientId.Trim(), req.From, req.To, req.Code);
            // T: coordinator seed; NC Group T off. C: 1 transport crash + N scope (P5).
            transport.Apply(result);
            await connections.ApplyAsync(result, ct).ConfigureAwait(false);
            // D6: close эпизода снимает hold-барьер (раньше — client backend.recovered).
            if (result.ClosedEmitted)
            {
                recoveryGate.Release();
                recoveryGate.ClearActiveIncident();
            }

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
