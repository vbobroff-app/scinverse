using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Contracts;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Domain.Moex;
using Scinverse.Ohs.Domain.Schedule;
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
            bool? nonEmpty, string? instrumentIds, string? exchanges, bool? includeOptionAncestors,
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
                IncludeOptionAncestors = includeOptionAncestors ?? true,
                Exchanges = ParseCsv(exchanges),
                UnderlyingId = underlyingId,
                Expiration = expiration,
                Limit = limit ?? 100,
                Offset = offset ?? 0
            }, ct);

            var items = page.Items
                .Select(i => new InstrumentDto(
                    i.InstrumentId, i.Ticker, i.Board, i.SecType, i.ShortName, i.Name, i.MinStep, i.Decimals,
                    i.Active, i.Recording, i.HasOptions, i.Strike, i.OptionType?.ToString(), i.Expiration,
                    i.UnderlyingId))
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

        // Лента Connection (phase 7h.8): жизненный цикл связи независимо от записи.
        api.MapPost("/coverage/link", async (
            LivenessQueryRequest request, ILinkLivenessStore store, CancellationToken ct) =>
        {
            var ids = new[] { request.SourceId };
            var intervals = await store.QueryAsync(ids, request.From, request.To, ct);
            var gaps = await store.QueryGapsAsync(ids, request.From, request.To, ct);
            return new LinkLivenessDto(
                intervals.Select(i => new LivenessIntervalDto(
                    i.From, i.To, i.Open, i.CloseReason is null ? null : ToLinkReasonDto(i.CloseReason.Value))).ToList(),
                gaps.Select(g => new CaptureGapDto(
                    g.From, g.To, ToLinkReasonDto(g.Cause))).ToList());
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

        api.MapDelete("/recordings/{instrumentId:long}", async (
            long instrumentId,
            RecordingManager recordings,
            IRecordingScheduleStore schedule,
            RecordingSupervisor supervisor,
            CancellationToken ct) =>
        {
            await recordings.StopAsync(instrumentId, ct);
            await schedule.DisableAutoAsync(instrumentId, ct);
            await supervisor.BroadcastScheduleAsync(ct);
            return Results.NoContent();
        });

        api.MapGet("/recording/schedule", async (IRecordingScheduleStore schedule, CancellationToken ct) =>
        {
            var rows = await schedule.ListAsync(ct);
            return rows.Select(e => new RecordingScheduleDto(e.InstrumentId, e.ConnectionId, e.AutoEnabled)).ToList();
        });

        api.MapPut("/recording/schedule", async (
            UpsertRecordingScheduleRequest request,
            IRecordingScheduleStore schedule,
            RecordingSupervisor supervisor,
            SchedulePreflight preflight,
            CancellationToken ct) =>
        {
            var entries = (request.Items ?? [])
                .Select(i => new RecordingScheduleEntry
                {
                    InstrumentId = i.InstrumentId,
                    ConnectionId = i.ConnectionId,
                    AutoEnabled = i.AutoEnabled,
                })
                .ToList();
            var rows = await schedule.UpsertAsync(entries, ct);
            supervisor.Nudge();
            await supervisor.BroadcastScheduleAsync(ct);

            // Pre-flight: постановка на Auto → запрос расписания у назначенного источника (подтверждение
            // перед записью). Пока результат логируется; далее — сверка с базой и авто-исключения.
            foreach (var entry in entries.Where(e => e.AutoEnabled))
            {
                await preflight.RequestAsync(entry.InstrumentId, ct);
            }

            return rows.Select(e => new RecordingScheduleDto(e.InstrumentId, e.ConnectionId, e.AutoEnabled)).ToList();
        });

        api.MapGet("/connections/{id:long}/schedule", async (
            long id, IConnectionScheduleStore schedule, CancellationToken ct) =>
        {
            var row = await schedule.GetCurrentAsync(id, ct);
            return row is null ? Results.NotFound() : Results.Ok(ToConnectionScheduleDto(row));
        });

        api.MapGet("/connections/{id:long}/schedule/history", async (
            long id, IConnectionScheduleStore schedule, CancellationToken ct) =>
        {
            var rows = await schedule.ListHistoryAsync(id, ct);
            return rows.Select(ToConnectionScheduleDto).ToList();
        });

        api.MapPut("/connections/{id:long}/schedule", async (
            long id,
            PutConnectionScheduleRequest request,
            IConnectionStore connections,
            IConnectionScheduleStore schedule,
            ConnectionSupervisor supervisor,
            CancellationToken ct) =>
        {
            if (await connections.GetAsync(id, ct) is null)
            {
                return Results.NotFound();
            }

            try
            {
                var result = await ApplyConnectionSchedulePutAsync(id, request, schedule, ct);
                supervisor.Nudge();
                return Results.Ok(ToConnectionScheduleDto(result));
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        api.MapGet("/notifications", (NotificationHub hub, int? limit) =>
            hub.List(limit is > 0 and <= 500 ? limit : 100));

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

        api.MapPost("/connections/{id:long}/connect", async (
            long id,
            ConnectionManager manager,
            IConnectionStore store,
            INotificationPublisher notifications,
            CancellationToken ct) =>
        {
            // Действие оператора (крит. #1): успех/неудача connect — user-события в ленте NC.
            try
            {
                var status = await manager.ConnectAsync(id, ct);
                var connection = await store.GetAsync(id, ct);
                if (connection is null)
                {
                    return Results.NotFound(new { error = $"Подключение {id} не найдено" });
                }

                notifications.Publish(
                    "connection.connect",
                    $"Подключение «{connection.Name}»: подключение по команде оператора",
                    severity: "info",
                    sourceType: "user",
                    data: new { connectionId = id, status });
                return Results.Ok(ToDto(connection, status));
            }
            catch (InvalidOperationException ex)
            {
                notifications.Publish(
                    "connection.connect.failed",
                    $"Подключение {id}: не удалось подключиться — {ex.Message}",
                    severity: "error", sourceType: "user", data: new { connectionId = id });
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                notifications.Publish(
                    "connection.connect.failed",
                    $"Подключение {id}: не удалось подключиться — {ex.Message}",
                    severity: "error", sourceType: "user", data: new { connectionId = id });
                throw;
            }
        });

        api.MapPost("/connections/{id:long}/disconnect", async (
            long id,
            ConnectionManager manager,
            IConnectionStore store,
            IConnectionScheduleStore schedule,
            ConnectionSupervisor supervisor,
            INotificationPublisher notifications,
            CancellationToken ct) =>
        {
            // Ручной off тумблера связи → Auto off (phase 7j), как Стоп записи снимает Auto записи.
            await schedule.SetModeAsync(id, ConnectionScheduleModes.Manual, ct);
            supervisor.Nudge();

            var status = await manager.DisconnectAsync(id, ct);
            var connection = await store.GetAsync(id, ct);
            if (connection is null)
            {
                return Results.NotFound(new { error = $"Подключение {id} не найдено" });
            }

            // Оператор оборвал связь: закрываем открытый инцидент (если был), чтобы он не «висел» красным.
            // Resolve — no-op при отсутствии инцидента, поэтому в штатном off лишней строки не будет.
            notifications.Resolve(
                ConnectionManager.LinkIncidentSubject(id),
                "connection.closed",
                $"Инцидент связи закрыт: подключение «{connection.Name}» отключено оператором",
                data: new { connectionId = id });
            notifications.Publish(
                "connection.disconnect",
                $"Подключение «{connection.Name}»: отключение по команде оператора",
                severity: "info",
                sourceType: "user",
                data: new { connectionId = id });
            return Results.Ok(ToDto(connection, status));
        });

        api.MapPost("/connections/{id:long}/test", (long id, ConnectionManager manager, IConnectionStore store, CancellationToken ct) =>
            RunConnectionActionAsync(id, store, manager, () => manager.TestAsync(id, ct), ct));

        // Диагностика: отдаёт ли TRANSAQ конкретный инструмент (get_securities_info).
        api.MapPost("/connections/{id:long}/probe-security", async (
            long id, ProbeSecurityRequest request, ConnectionManager manager, CancellationToken ct) =>
        {
            try
            {
                var (marketId, result) = await manager.ProbeSecurityAsync(
                    id, request.Market, request.Board, request.Seccode, request.TimeoutSeconds, ct);
                return Results.Ok(new ProbeSecurityResultDto(
                    result.CommandAccepted,
                    result.FoundInCallback,
                    marketId,
                    request.Seccode.Trim(),
                    result.CommandResultXml,
                    result.CallbackXml,
                    result.Message));
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        if (app.Environment.IsDevelopment())
        {
            api.MapPost("/connections/{id:long}/debug/drop", (long id, int? seconds, ConnectionManager manager) =>
            {
                var duration = TimeSpan.FromSeconds(Math.Clamp(seconds ?? 30, 1, 300));
                return manager.TryDebugDrop(id, duration)
                    ? Results.Ok(new { ok = true, seconds = duration.TotalSeconds })
                    : Results.BadRequest(new { error = "Инжект обрыва доступен только для synthetic-коннектора" });
            });
        }

        MapExchanges(api);
        MapIntegrations(api);
    }

    /// <summary>
    /// Внешние сервисы-интеграции (external_service, phase 7i): CRUD + health-check (auth) +
    /// расписание инструмента. MVP-адаптер — finam (подтверждатель расписания).
    /// </summary>
    private static void MapIntegrations(RouteGroupBuilder api)
    {
        var integrations = api.MapGroup("/integrations");

        integrations.MapGet("", async (IExternalServiceStore store, CancellationToken ct) =>
        {
            var services = await store.ListAsync(ct);
            return services.Select(ToDto).ToList();
        });

        integrations.MapPost("", async (
            UpsertExternalServiceRequest request, IExternalServiceStore store, CancellationToken ct) =>
        {
            var service = await store.CreateAsync(
                request.Name, request.Adapter, request.Transport,
                NormalizeSecret(request.Secret), request.SecretExpiresOn, request.Enabled, ct);
            return service is null
                ? Results.Json(
                    new { error = $"Интеграция с именем «{request.Name}» уже существует" },
                    statusCode: StatusCodes.Status409Conflict)
                : Results.Ok(ToDto(service));
        });

        integrations.MapPut("/{id:long}", async (
            long id, UpsertExternalServiceRequest request, IExternalServiceStore store, CancellationToken ct) =>
        {
            var updated = await store.UpdateAsync(
                id, request.Name, request.Adapter, request.Transport,
                NormalizeSecret(request.Secret), request.SecretExpiresOn, request.Enabled, ct);
            return updated is null ? Results.NotFound() : Results.Ok(ToDto(updated));
        });

        integrations.MapDelete("/{id:long}", async (long id, IExternalServiceStore store, CancellationToken ct) =>
            await store.DeleteAsync(id, ct) ? Results.NoContent() : Results.NotFound());

        // Назначить/снять сервис источником системного расписания (capability «schedule»). Эксклюзивно.
        integrations.MapPost("/{id:long}/schedule-source", async (
            long id, bool? enabled, IExternalServiceStore store, CancellationToken ct) =>
        {
            var updated = await store.SetScheduleSourceAsync(id, enabled ?? true, ct);
            return updated is null ? Results.NotFound() : Results.Ok(ToDto(updated));
        });

        // Health-check: делегируется адаптеру подтверждателя (Finam — auth по секрету; ISS — доступность).
        // Ошибка → {ok:false} (200), не 5xx — фронт покажет причину.
        integrations.MapPost("/{id:long}/probe", async (
            long id, IExternalServiceStore store, IScheduleConfirmerRegistry confirmers, CancellationToken ct) =>
        {
            var service = await store.GetAsync(id, ct);
            if (service is null)
            {
                return Results.NotFound();
            }

            var confirmer = confirmers.ForAdapter(service.Adapter);
            if (confirmer is null)
            {
                return Results.Ok(new IntegrationProbeResultDto(false, $"Адаптер «{service.Adapter}» пока не поддержан"));
            }

            string? secret = null;
            if (confirmer.RequiresSecret)
            {
                secret = await store.GetSecretAsync(id, ct);
                if (string.IsNullOrWhiteSpace(secret))
                {
                    return Results.Ok(new IntegrationProbeResultDto(false, "Секрет не задан"));
                }
            }

            var probe = await confirmer.ProbeAsync(new ConfirmerQuery(null, null, TodayMsk(), secret), ct);
            return Results.Ok(new IntegrationProbeResultDto(probe.Ok, probe.Message));
        });

        // Расписание (рабочая область). Символ Finam (SBER@MISX) ИЛИ движок ISS (futures/stock/currency) —
        // адаптер берёт своё. Маршрутизация по service.adapter через реестр подтверждателей.
        integrations.MapGet("/{id:long}/schedule", async (
            long id, string? symbol, string? engine,
            IExternalServiceStore store, IScheduleConfirmerRegistry confirmers, CancellationToken ct) =>
        {
            var service = await store.GetAsync(id, ct);
            if (service is null)
            {
                return Results.NotFound();
            }

            var confirmer = confirmers.ForAdapter(service.Adapter);
            if (confirmer is null)
            {
                return Results.BadRequest(new { error = $"Адаптер «{service.Adapter}» не поддержан" });
            }

            string? secret = null;
            if (confirmer.RequiresSecret)
            {
                secret = await store.GetSecretAsync(id, ct);
                if (string.IsNullOrWhiteSpace(secret))
                {
                    return Results.BadRequest(new { error = "Секрет не задан для этой интеграции" });
                }
            }

            var query = new ConfirmerQuery(
                string.IsNullOrWhiteSpace(symbol) ? null : symbol.Trim(),
                string.IsNullOrWhiteSpace(engine) ? null : engine.Trim(),
                TodayMsk(),
                secret);

            return await ExternalAsync(async token =>
            {
                var s = await confirmer.GetScheduleAsync(query, token);
                return new ExternalScheduleDto(
                    s.Subject,
                    s.Sessions.Select(x => new ExternalSessionDto(x.RawType, x.Start, x.End)).ToList());
            }, ct);
        });

        // Торговый календарь движка (capability «calendar», ISS dailytable): праздники/переносы на диапазон.
        // Только для адаптеров, реализующих ICalendarConfirmer. По умолчанию — сегодня + 30 дней.
        integrations.MapGet("/{id:long}/calendar", async (
            long id, string? engine, DateOnly? from, DateOnly? to,
            IExternalServiceStore store, IScheduleConfirmerRegistry confirmers, CancellationToken ct) =>
        {
            var service = await store.GetAsync(id, ct);
            if (service is null)
            {
                return Results.NotFound();
            }

            if (confirmers.ForAdapter(service.Adapter) is not ICalendarConfirmer calendar)
            {
                return Results.BadRequest(new { error = $"Адаптер «{service.Adapter}» не поддерживает календарь" });
            }

            var eng = string.IsNullOrWhiteSpace(engine) ? "futures" : engine.Trim();
            var start = from ?? TodayMsk();
            var end = to ?? start.AddDays(30);

            return await ExternalAsync(async token =>
            {
                var cal = await calendar.GetCalendarAsync(eng, start, end, token);
                return new ExternalCalendarDto(
                    cal.Subject,
                    cal.Days
                        .Select(d => new ExternalCalendarDayDto(d.Date, d.IsTradingDay, d.IsException, d.Open, d.Close))
                        .ToList());
            }, ct);
        });
    }

    /// <summary>Сегодняшняя дата в МСК (для запросов расписания к подтверждателю).</summary>
    private static DateOnly TodayMsk() =>
        DateOnly.FromDateTime(DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(3)).DateTime);

    /// <summary>Пустой/пробельный секрет → null («не менять» / «не задан»).</summary>
    private static string? NormalizeSecret(string? secret) =>
        string.IsNullOrWhiteSpace(secret) ? null : secret.Trim();

    /// <summary>Обёртка запросов к внешнему API: недоступность/ошибка → 502, чтобы фронт показал причину.</summary>
    private static async Task<IResult> ExternalAsync<T>(Func<CancellationToken, Task<T>> action, CancellationToken ct)
    {
        try
        {
            return Results.Ok(await action(ct));
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException)
        {
            return Results.Json(new { error = ex.Message }, statusCode: StatusCodes.Status502BadGateway);
        }
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

        // Действующее на дату базовое расписание РЫНКА (курируемая market_schedule, из БД — без ISS).
        exchanges.MapGet("/{market}/schedule", async (
            string market, DateOnly? on, IMarketScheduleStore store, CancellationToken ct) =>
        {
            var date = on ?? DateOnly.FromDateTime(DateTime.UtcNow.Add(MoexSchedule.MoscowOffset));
            var version = await store.GetActiveAsync(market, date, ct);
            return version is null
                ? Results.NotFound(new { error = $"Нет расписания для рынка «{market}»" })
                : Results.Ok(new MarketScheduleDto(
                    version.Market, version.EffectiveFrom, version.WdOpen, version.WdClose,
                    version.WeOpen, version.WeClose,
                    version.Weekday.Select(p => new SchedulePhaseDto(p.Key, p.From, p.Till)).ToList(),
                    version.Weekend.Select(p => new SchedulePhaseDto(p.Key, p.From, p.Till)).ToList(),
                    version.Confidence, version.Source, version.Note));
        });

        // Исключения по датам для рынка (market_schedule_exception). unresolved=true → только неразобранные.
        exchanges.MapGet("/{market}/exceptions", async (
            string market, bool? unresolved, IMarketScheduleStore store, CancellationToken ct) =>
        {
            var rows = await store.ListExceptionsAsync(market, unresolved ?? true, ct);
            return rows.Select(e => new MarketScheduleExceptionDto(
                e.ExcDate, e.Market, e.SecType, e.Category, e.Instrument, e.Kind,
                e.OpenTime, e.CloseTime, e.Confidence, e.Source, e.Resolved, e.Note)).ToList();
        });
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

    private static async Task<ConnectionScheduleEntry> ApplyConnectionSchedulePutAsync(
        long connectionId,
        PutConnectionScheduleRequest request,
        IConnectionScheduleStore schedule,
        CancellationToken ct)
    {
        var mode = ResolveMode(request);
        var hasWindow = !string.IsNullOrWhiteSpace(request.WindowStart)
            && !string.IsNullOrWhiteSpace(request.WindowEnd);

        if (hasWindow)
        {
            var start = ParseScheduleTime(request.WindowStart!);
            var end = ParseScheduleTime(request.WindowEnd!);
            var engine = string.IsNullOrWhiteSpace(request.Engine) ? "futures" : request.Engine.Trim();
            var tz = string.IsNullOrWhiteSpace(request.Tz) ? "Europe/Moscow" : request.Tz.Trim();
            var source = string.IsNullOrWhiteSpace(request.ChangeSource) ? "api" : request.ChangeSource.Trim();
            return await schedule.PublishWindowAsync(
                connectionId, mode, start, end, engine, tz, source, request.ChangeNote, ct);
        }

        var updated = await schedule.SetModeAsync(connectionId, mode, ct);
        return updated
            ?? throw new InvalidOperationException(
                "Нет утверждённого расписания — сначала задайте окно (WindowStart/WindowEnd)");
    }

    private static string ResolveMode(PutConnectionScheduleRequest request)
    {
        if (!string.IsNullOrWhiteSpace(request.Mode))
        {
            return request.Mode.Trim().ToLowerInvariant() switch
            {
                "manual" or "off" => ConnectionScheduleModes.Manual,
                "scheduled" or "auto" or "on" => ConnectionScheduleModes.Scheduled,
                var m => throw new ArgumentException($"Неизвестный mode: {m}"),
            };
        }

        if (request.AutoEnabled is bool auto)
        {
            return auto ? ConnectionScheduleModes.Scheduled : ConnectionScheduleModes.Manual;
        }

        // Публикация окна без явного mode — по умолчанию manual (Auto отдельно).
        return ConnectionScheduleModes.Manual;
    }

    private static TimeOnly ParseScheduleTime(string text)
    {
        if (TimeOnly.TryParse(text, System.Globalization.CultureInfo.InvariantCulture, out var t))
        {
            return t;
        }

        throw new ArgumentException($"Некорректное время: {text}");
    }

    private static ConnectionScheduleDto ToConnectionScheduleDto(ConnectionScheduleEntry e) => new(
        e.ScheduleId,
        e.ConnectionId,
        e.Mode,
        e.AutoEnabled,
        e.WindowStart.ToString("HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture),
        e.WindowEnd.ToString("HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture),
        e.Engine,
        e.Tz,
        e.EffectiveFrom,
        e.EffectiveTo,
        e.ChangeSource,
        e.ChangeNote);

    private static ConnectionDto ToDto(ConnectorConnection connection, string status) => new(
        connection.ConnectionId, connection.SourceId, connection.Name, connection.Kind, connection.Settings,
        connection.Enabled, status);

    private static ExternalServiceDto ToDto(ExternalService service) => new(
        service.ServiceId, service.Name, service.Adapter, service.Transport,
        service.HasSecret, service.SecretExpiresOn, service.Enabled, service.UseForSchedule);

    private static string ToLivenessReasonDto(CaptureCloseReason reason) => reason switch
    {
        CaptureCloseReason.Stopped => "stopped",
        CaptureCloseReason.ServerDown => "server_down",
        CaptureCloseReason.PingFailed => "ping_failed",
        CaptureCloseReason.Interrupted => "interrupted",
        _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
    };

    private static string ToLinkReasonDto(LinkCloseReason reason) => reason switch
    {
        LinkCloseReason.Disconnected => "disconnected",
        LinkCloseReason.ServerDown => "server_down",
        LinkCloseReason.PingFailed => "ping_failed",
        LinkCloseReason.Interrupted => "interrupted",
        _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
    };
}
