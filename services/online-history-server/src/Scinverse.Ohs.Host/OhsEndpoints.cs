using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Contracts;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>REST-эндпоинты control-plane OHS (Minimal API). Контракт — <see cref="IOhsApi"/>.</summary>
public static class OhsEndpoints
{
    public static void MapOhsApi(this WebApplication app)
    {
        var api = app.MapGroup("/api");

        api.MapGet("/instruments", async (
            string? q, string? board, string? secType, string? category, bool? onlyRecording,
            long? underlyingId, DateOnly? expiration, int? limit, int? offset,
            IInstrumentStore store, CancellationToken ct) =>
        {
            var page = await store.QueryAsync(new InstrumentQuery
            {
                Search = q,
                Board = board,
                SecType = secType,
                Category = category,
                OnlyRecording = onlyRecording ?? false,
                UnderlyingId = underlyingId,
                Expiration = expiration,
                Limit = limit ?? 100,
                Offset = offset ?? 0
            }, ct);

            var items = page.Items
                .Select(i => new InstrumentDto(
                    i.InstrumentId, i.Ticker, i.Board, i.SecType, i.ShortName, i.Name, i.MinStep, i.Decimals,
                    i.Active, i.Recording, i.HasOptions, i.Strike, i.OptionType?.ToString(), i.Expiration))
                .ToList();

            return new InstrumentPageDto(items, page.Total, page.Limit, page.Offset);
        });

        api.MapGet("/instruments/groups", async (
            string level, long? underlyingId, IInstrumentStore store, CancellationToken ct) =>
        {
            var groups = await store.QueryGroupsAsync(new GroupQuery
            {
                Level = level,
                UnderlyingId = underlyingId
            }, ct);

            return groups.Select(g => new InstrumentGroupDto(g.Key, g.Label, g.Count, g.Expiration, g.Badge)).ToList();
        });

        // Dev: повторно обогащает derivative для уже загруженных FUT/OPT (backfill после импорта
        // справочника до того, как парсер деривативов существовал). Идемпотентно.
        api.MapPost("/maintenance/reenrich", async (
            IInstrumentStore store, IInstrumentRegistry registry, CancellationToken ct) =>
        {
            var candidates = await store.LoadDerivativeCandidatesAsync(ct);
            foreach (var security in candidates)
            {
                await registry.RegisterAsync(security, ct);
            }

            return Results.Ok(new { processed = candidates.Count });
        });

        api.MapGet("/sources", async (ISourceStore store, CancellationToken ct) =>
        {
            var sources = await store.ListAsync(ct);
            return sources.Select(s => new SourceDto(s.SourceId, s.Code, s.Name)).ToList();
        });

        api.MapGet("/coverage", async (
            DateTimeOffset from, DateTimeOffset to, ICoverageStore store, OhsOptions options, CancellationToken ct) =>
        {
            var segments = await store.QuerySegmentsAsync(from, to, ct);
            var result = new List<CoverageSegmentDto>(segments.Count);
            foreach (var segment in segments)
            {
                var gapTo = segment.EndedAt ?? to;
                var gaps = await store.QueryGapsAsync(
                    segment.InstrumentId, segment.SourceId, segment.StartedAt, gapTo, options.GapThresholdSeconds, ct);

                result.Add(new CoverageSegmentDto(
                    segment.SegmentId, segment.InstrumentId, segment.SourceId, segment.StartedAt, segment.EndedAt,
                    segment.TradeCount, segment.Status, gaps.Select(g => new GapDto(g.From, g.To)).ToList()));
            }

            return result;
        });

        api.MapGet("/recordings", (RecordingManager recordings) =>
            recordings.List().Select(ToDto).ToList());

        api.MapPost("/recordings", async (StartRecordingRequest request, RecordingManager recordings, CancellationToken ct) =>
        {
            try
            {
                var info = await recordings.StartAsync(request.InstrumentId, request.ConnectionId, ct);
                return Results.Ok(ToDto(info));
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        api.MapDelete("/recordings/{instrumentId:long}", async (long instrumentId, RecordingManager recordings, CancellationToken ct) =>
        {
            await recordings.StopAsync(instrumentId, ct);
            return Results.NoContent();
        });

        api.MapGet("/connections", async (IConnectionStore store, ConnectionManager manager, CancellationToken ct) =>
        {
            var connections = await store.ListAsync(ct);
            return connections.Select(c => ToDto(c, manager.GetStatus(c.ConnectionId))).ToList();
        });

        api.MapPost("/connections", async (UpsertConnectionRequest request, IConnectionStore store, ConnectionManager manager, CancellationToken ct) =>
        {
            var connection = await store.UpsertAsync(
                request.SourceId, request.Name, request.Kind, request.Settings, request.Enabled, ct);
            return Results.Ok(ToDto(connection, manager.GetStatus(connection.ConnectionId)));
        });

        api.MapPut("/connections/{id:long}/credentials", (long id, ConnectionCredentialsRequest request, ICredentialStore credentials) =>
        {
            credentials.Set(id, new ConnectorCredentials(request.Login, request.Password));
            return Results.NoContent();
        });

        api.MapPost("/connections/{id:long}/connect", (long id, ConnectionManager manager, IConnectionStore store, CancellationToken ct) =>
            RunConnectionActionAsync(id, store, manager, () => manager.ConnectAsync(id, ct), ct));

        api.MapPost("/connections/{id:long}/disconnect", (long id, ConnectionManager manager, IConnectionStore store, CancellationToken ct) =>
            RunConnectionActionAsync(id, store, manager, () => manager.DisconnectAsync(id, ct), ct));

        api.MapPost("/connections/{id:long}/test", (long id, ConnectionManager manager, IConnectionStore store, CancellationToken ct) =>
            RunConnectionActionAsync(id, store, manager, () => manager.TestAsync(id, ct), ct));
    }

    private static async Task<IResult> RunConnectionActionAsync(
        long id, IConnectionStore store, ConnectionManager manager, Func<Task<string>> action, CancellationToken ct)
    {
        try
        {
            var status = await action();
            var connection = await store.GetAsync(id, ct);
            return connection is null
                ? Results.NotFound(new { error = $"Подключение {id} не найдено" })
                : Results.Ok(ToDto(connection, status));
        }
        catch (InvalidOperationException ex)
        {
            return Results.BadRequest(new { error = ex.Message });
        }
    }

    private static RecordingDto ToDto(RecordingInfo info) => new(
        info.InstrumentId, info.Ticker, info.Board, info.SourceId, info.ConnectionId, info.SegmentId,
        info.StartedAt, info.TradeCount);

    private static ConnectionDto ToDto(ConnectorConnection connection, string status) => new(
        connection.ConnectionId, connection.SourceId, connection.Name, connection.Kind, connection.Settings,
        connection.Enabled, status);
}
