using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Contracts;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Domain.Moex;
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
            bool? nonEmpty, string? instrumentIds, string? exchanges,
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
                NonEmpty = nonEmpty ?? false,
                InstrumentIds = ParseLongs(instrumentIds),
                Exchanges = ParseCsv(exchanges),
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

        api.MapGet("/sessions", async (
            int? count, bool? includeWeekends, string? engine,
            ICoverageStore store, IMarketCalendar calendar, CancellationToken ct) =>
        {
            // Дни — из наших данных (учитывают реальные торги, вкл. записанные ДСВД-выходные); часы —
            // дат-точные из ISS-календаря движка (сокращённые/регламентные), праздники исключаются.
            var days = await store.QueryTradingDaysAsync(count ?? 1, includeWeekends ?? false, ct);
            var sessions = await calendar.ShapeSessionsAsync(
                string.IsNullOrWhiteSpace(engine) ? "futures" : engine, days, ct);
            return sessions
                .Select(s => new SessionDto(s.Date, s.Start, s.End, s.Weekend))
                .ToList();
        });

        api.MapGet("/coverage/extent", async (short? sourceId, ICoverageStore store, CancellationToken ct) =>
        {
            var extent = await store.QueryCoverageExtentAsync(sourceId, ct);
            return new CoverageExtentDto(extent.From, extent.To);
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

        api.MapPost("/coverage/activity", async (
            TradeActivityRequest request, ITradeActivityStore store, CancellationToken ct) =>
        {
            var activity = await store.QueryActivityAsync(
                request.InstrumentIds, request.SourceId, request.From, request.To,
                TimeSpan.FromSeconds(request.BucketSeconds), ct);

            return activity.Select(a => new TradeActivityDto(a.InstrumentId, a.Buckets)).ToList();
        });

        api.MapPost("/coverage/liveness", async (
            LivenessQueryRequest request, ICaptureLivenessStore store, CancellationToken ct) =>
        {
            var ids = new[] { request.SourceId };
            var intervals = await store.QueryAsync(ids, request.From, request.To, ct);
            var gaps = await store.QueryGapsAsync(ids, request.From, request.To, ct);
            return new CaptureLivenessDto(
                intervals.Select(i => new LivenessIntervalDto(
                    i.From, i.To, i.Open, i.CloseReason is null ? null : ToLivenessReasonDto(i.CloseReason.Value))).ToList(),
                gaps.Select(g => new CaptureGapDto(
                    g.From, g.To, ToLivenessReasonDto(g.Cause))).ToList());
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

        api.MapPut("/connections/{id:long}", async (long id, UpsertConnectionRequest request, IConnectionStore store, ConnectionManager manager, CancellationToken ct) =>
        {
            var updated = await store.UpdateAsync(id, request.SourceId, request.Name, request.Kind, request.Settings, request.Enabled, ct);
            return updated is null
                ? Results.NotFound()
                : Results.Ok(ToDto(updated, manager.GetStatus(id)));
        });

        api.MapDelete("/connections/{id:long}", async (long id, IConnectionStore store, ConnectionManager manager, ICredentialStore credentials, CancellationToken ct) =>
        {
            var existing = await store.GetAsync(id, ct);
            if (existing is null)
            {
                return Results.NotFound();
            }

            // Гасим живую сессию и чистим креды из памяти перед удалением строки.
            await manager.DisconnectAsync(id, ct);
            credentials.Clear(id);
            await store.DeleteAsync(id, ct);
            return Results.NoContent();
        });

        api.MapPut("/connections/{id:long}/credentials", (long id, ConnectionCredentialsRequest request, ICredentialStore credentials) =>
        {
            credentials.Set(id, new ConnectorCredentials(request.Login, request.Password));
            return Results.NoContent();
        });

        // ВРЕМЕННО (dev): префилл формы подключения из appsettings.Local.json.
        api.MapGet("/connections/transaq-local-defaults", (IWebHostEnvironment env, TransaqConnectorOptions options) =>
        {
            if (!env.IsDevelopment())
            {
                return Results.NotFound();
            }

            var creds = DevLocalTransaqCredentials.TryCreate(options);
            return Results.Ok(new TransaqLocalDefaultsDto(creds?.Login, creds?.Password));
        });

        api.MapPost("/connections/validate", async (ValidateConnectionRequest request, ConnectionManager manager, CancellationToken ct) =>
        {
            var creds = string.IsNullOrWhiteSpace(request.Login)
                ? null
                : new ConnectorCredentials(request.Login, request.Password ?? string.Empty);
            var (ok, message) = await manager.ValidateAsync(request.Kind, request.Settings, creds, ct);
            return Results.Ok(new ValidateConnectionResult(ok, message));
        });

        api.MapPost("/connections/{id:long}/connect", (long id, ConnectionManager manager, IConnectionStore store, CancellationToken ct) =>
            RunConnectionActionAsync(id, store, manager, () => manager.ConnectAsync(id, ct), ct));

        api.MapPost("/connections/{id:long}/disconnect", (long id, ConnectionManager manager, IConnectionStore store, CancellationToken ct) =>
            RunConnectionActionAsync(id, store, manager, () => manager.DisconnectAsync(id, ct), ct));

        api.MapPost("/connections/{id:long}/test", (long id, ConnectionManager manager, IConnectionStore store, CancellationToken ct) =>
            RunConnectionActionAsync(id, store, manager, () => manager.TestAsync(id, ct), ct));

        MapExchanges(api);
    }

    /// <summary>Структура биржи из MOEX ISS (движки → рынки → борды → инструменты). Прокси/кэш над ISS.</summary>
    private static void MapExchanges(RouteGroupBuilder api)
    {
        var exchanges = api.MapGroup("/exchanges");

        exchanges.MapGet("/engines", (IExchangeCatalog catalog, CancellationToken ct) =>
            IssAsync(async token =>
            {
                var engines = await catalog.GetEnginesAsync(token);
                return engines.Select(e => new EngineDto(e.Name, e.Title)).ToList();
            }, ct));

        exchanges.MapGet("/{engine}/markets", (string engine, IExchangeCatalog catalog, CancellationToken ct) =>
            IssAsync(async token =>
            {
                var markets = await catalog.GetMarketsAsync(engine, token);
                return markets.Select(m => new MarketDto(m.Name, m.Title)).ToList();
            }, ct));

        exchanges.MapGet("/{engine}/{market}/boards", (string engine, string market, IExchangeCatalog catalog, CancellationToken ct) =>
            IssAsync(async token =>
            {
                var boards = await catalog.GetBoardsAsync(engine, market, token);
                return boards.Select(b => new BoardDto(b.BoardId, b.Title, b.IsTraded)).ToList();
            }, ct));

        exchanges.MapGet("/{engine}/{market}/{board}/securities", (string engine, string market, string board, IExchangeCatalog catalog, CancellationToken ct) =>
            IssAsync(async token =>
            {
                var securities = await catalog.GetBoardSecuritiesAsync(engine, market, board, token);
                return securities
                    .Select(s => new IssSecurityDto(
                        s.SecId, s.ShortName, s.Name, s.MinStep, s.LotSize, s.Decimals,
                        s.AssetCode, s.Expiration, s.SecType))
                    .ToList();
            }, ct));

        // Справочник классов базового актива фьючерсов (из БД).
        exchanges.MapGet("/asset-classes", async (IFuturesAssetClassStore store, CancellationToken ct) =>
        {
            var rows = await store.ListAsync(ct);
            return rows
                .Select(r => new FuturesAssetClassDto(
                    r.AssetCode, r.Category, r.Subcategory, r.Title, r.Source, r.Confirmed))
                .ToList();
        });

        // Актуализация справочника из ISS (по кнопке). Бьёт в ISS → оборачиваем в IssAsync.
        exchanges.MapPost("/asset-classes/refresh", (FuturesAssetClassifier classifier, CancellationToken ct) =>
            IssAsync(async token =>
            {
                var summary = await classifier.RefreshAsync(token);
                return new AssetClassRefreshResultDto(summary.Total, summary.Inserted, summary.Unresolved);
            }, ct));

        // Торговый календарь движка (бесплатный /iss/engines/{engine}: timetable+dailytable).
        exchanges.MapGet("/{engine}/calendar", (
            string engine, DateOnly? from, DateOnly? till, IExchangeCatalog catalog, CancellationToken ct) =>
            IssAsync(async token =>
            {
                var calendar = await catalog.GetEngineCalendarAsync(engine, token);
                var today = DateOnly.FromDateTime(DateTime.UtcNow.Add(MoexSchedule.MoscowOffset));
                var start = from ?? new DateOnly(today.Year, today.Month, 1);
                var end = till ?? start.AddMonths(3).AddDays(-1);
                if (end < start)
                {
                    (start, end) = (end, start);
                }

                var days = new List<CalendarDayDto>();
                for (var date = start; date <= end && days.Count < 500; date = date.AddDays(1))
                {
                    var info = calendar.Describe(date);
                    days.Add(new CalendarDayDto(
                        date, info.IsTrading, info.Weekend, info.Exception, ClassifyKind(info), info.Open, info.Close));
                }

                return days;
            }, ct));
    }

    /// <summary>Классифицирует день для UI: regular · transfer (рабочий перенос) · dsvd (выходной торговый) · weekend · holiday.</summary>
    private static string ClassifyKind(EngineCalendarDay day) =>
        !day.IsTrading ? (day.Weekend ? "weekend" : "holiday")
        : day.Weekend ? "dsvd"
        : day.Exception ? "transfer"
        : "regular";

    /// <summary>
    /// Обёртка ISS-запросов: результат → 200; недоступность ISS (сеть/таймаут) → 502 Bad Gateway
    /// с сообщением, чтобы фронт показал понятную ошибку, а не «упавший» запрос.
    /// </summary>
    private static async Task<IResult> IssAsync<T>(Func<CancellationToken, Task<T>> action, CancellationToken ct)
    {
        try
        {
            return Results.Ok(await action(ct));
        }
        catch (HttpRequestException ex)
        {
            return Results.Json(new { error = $"MOEX ISS недоступен: {ex.Message}" }, statusCode: StatusCodes.Status502BadGateway);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            return Results.Json(new { error = "MOEX ISS: таймаут запроса" }, statusCode: StatusCodes.Status504GatewayTimeout);
        }
    }

    /// <summary>Парсит CSV-параметр (`a,b,c`) в массив непустых значений; null/пусто → null.</summary>
    private static string[]? ParseCsv(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? null
            : value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>Парсит CSV из long-идентификаторов; невалидные элементы отбрасываются; null/пусто → null.</summary>
    private static List<long>? ParseLongs(string? value)
    {
        var parts = ParseCsv(value);
        if (parts is null)
        {
            return null;
        }

        var ids = parts
            .Select(p => long.TryParse(p, out var id) ? id : (long?)null)
            .Where(id => id is not null)
            .Select(id => id!.Value)
            .ToList();

        return ids.Count > 0 ? ids : null;
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

    private static string ToLivenessReasonDto(CaptureCloseReason reason) => reason switch
    {
        CaptureCloseReason.Stopped => "stopped",
        CaptureCloseReason.ServerDown => "server_down",
        CaptureCloseReason.PingFailed => "ping_failed",
        CaptureCloseReason.Interrupted => "interrupted",
        _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
    };
}
