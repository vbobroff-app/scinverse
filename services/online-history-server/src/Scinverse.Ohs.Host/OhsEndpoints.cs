using System.Text.Json;
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
            LivenessQueryRequest request,
            ILinkLivenessStore store,
            OhsOptions ohsOptions,
            CancellationToken ct) =>
        {
            var ids = new[] { request.SourceId };
            var intervals = await store.QueryAsync(ids, request.From, request.To, ct);
            var gaps = await store.QueryGapsAsync(ids, request.From, request.To, ct);
            var grace = ohsOptions.LinkRecoverGraceSeconds > 0 ? ohsOptions.LinkRecoverGraceSeconds : 60;
            return new LinkLivenessDto(
                intervals.Select(i => new LivenessIntervalDto(
                    i.From, i.To, i.Open, i.CloseReason is null ? null : ToLinkReasonDto(i.CloseReason.Value))).ToList(),
                gaps.Select(g => new CaptureGapDto(
                    g.From, g.To, ToLinkReasonDto(g.Cause), g.EscalatedAt, g.Abandoned)).ToList(),
                grace);
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
            var state = await schedule.GetStateAsync(id, ct);
            return Results.Ok(ToScheduleStateDto(state));
        });

        api.MapGet("/connections/{id:long}/schedule/history", async (
            long id, IConnectionScheduleStore schedule, CancellationToken ct) =>
        {
            var rows = await schedule.ListHistoryAsync(id, ct);
            return rows.Select(ToScheduleRuleDto).ToList();
        });

        api.MapPut("/connections/{id:long}/schedule/settings", async (
            long id,
            PutConnectionScheduleSettingsRequest request,
            IConnectionStore connections,
            IConnectionScheduleStore schedule,
            ConnectionSupervisor supervisor,
            INotificationPublisher notifications,
            CancellationToken ct) =>
        {
            var connection = await connections.GetAsync(id, ct);
            if (connection is null)
            {
                return Results.NotFound();
            }

            try
            {
                var settings = await schedule.SetSettingsAsync(
                    id, request.AutoEnabled, request.Engine, request.Tz, ct);
                supervisor.Nudge();

                // 2a: публикуем только при явном переключении Auto (плановое действие оператора → info).
                if (request.AutoEnabled is { } auto)
                {
                    notifications.Publish(
                        auto ? "connection.schedule.auto_enabled" : "connection.schedule.auto_disabled",
                        $"{ScheduleWho(id, connection.Name)}: автоподключение {(auto ? "включено" : "выключено")}",
                        severity: "info", sourceType: "user", data: new { connectionId = id });
                }

                return Results.Ok(ToScheduleSettingsDto(settings));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // 2b: инфра/БД → user·error + system·error (тумблер в UI откатится по refresh).
                notifications.Publish(
                    "connection.schedule.settings_failed",
                    $"{ScheduleWho(id, connection.Name)}: не удалось изменить автоподключение",
                    severity: "error", sourceType: "user",
                    data: new { connectionId = id, lines = _settingsFailedUserLines });
                notifications.Publish(
                    "connection.schedule.storage_error",
                    $"Расписание {id}: ошибка хранилища при сохранении настроек",
                    severity: "error", sourceType: "system",
                    data: new
                    {
                        connectionId = id,
                        result = $"Настройка не записана, состояние не изменено; {SummarizeException(ex)}",
                        sender = "backend",
                    });
                return Results.Json(
                    new { error = "Не удалось изменить настройки расписания" },
                    statusCode: StatusCodes.Status500InternalServerError);
            }
        });

        // Атомарная пачка (Saga, всё-или-ничего): один запрос заменяет N PUT/cancel + compose.
        // Успех → user·info summary + system·info batch. Валидация → 400 без NC (инлайн-баннер).
        // Инфра/БД → rollback (в store) + user·error + system·error, 500. Не найдено → 404 + user·warning.
        api.MapPost("/connections/{id:long}/schedule/batch", async (
            long id,
            ScheduleBatchRequest request,
            IConnectionStore connections,
            IConnectionScheduleStore schedule,
            ConnectionSupervisor supervisor,
            INotificationPublisher notifications,
            ILoggerFactory loggerFactory,
            CancellationToken ct) =>
        {
            var batchId = string.IsNullOrWhiteSpace(request.BatchId)
                ? Guid.NewGuid().ToString("N")
                : request.BatchId.Trim();

            var kind = (request.Kind ?? "").Trim().ToLowerInvariant();
            if (kind is not ("cleared" or "applied" or "recreated"))
            {
                return Results.BadRequest(new { error = "kind: cleared | applied | recreated" });
            }

            var connection = await connections.GetAsync(id, ct);
            if (connection is null)
            {
                // 1d: подключение не найдено → 404, user·warning (не инфра-сбой).
                notifications.Publish(
                    "connection.schedule.batch_failed",
                    $"Расписание {id}: не удалось сохранить изменения — подключение не найдено",
                    severity: "warning", sourceType: "user",
                    data: new { connectionId = id, batchId },
                    correlationId: batchId);
                return Results.NotFound(new { error = $"Подключение {id} не найдено" });
            }

            List<ConnectionScheduleRuleDraft> drafts;
            try
            {
                drafts = (request.Upserts ?? []).Select(ToRuleDraft).ToList();
            }
            catch (ArgumentException ex)
            {
                // 1b: валидация ввода → 400, БЕЗ NC (не шумим лентой из-за опечаток).
                return Results.BadRequest(new { error = ex.Message });
            }

            ScheduleBatchResult result;
            try
            {
                result = await schedule.ApplyBatchAsync(id, drafts, request.Cancels ?? [], ct);
            }
            catch (ArgumentException ex)
            {
                // 1b: доменная валидация внутри store → 400, БЕЗ NC.
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // 1c: инфра/БД — транзакция откачена в store; user·error + system·error, 500.
                loggerFactory.CreateLogger("OhsEndpoints").LogError(
                    ex, "Сбой сохранения пачки расписания {ConnectionId} (batchId={BatchId})", id, batchId);
                notifications.Publish(
                    "connection.schedule.batch_failed",
                    $"{ScheduleWho(id, connection.Name)}: не удалось сохранить изменения",
                    severity: "error", sourceType: "user",
                    data: new { connectionId = id, batchId, lines = _batchFailedUserLines },
                    correlationId: batchId);
                notifications.Publish(
                    "connection.schedule.storage_error",
                    $"Расписание {id}: ошибка хранилища при сохранении пачки",
                    severity: "error", sourceType: "system",
                    data: new
                    {
                        connectionId = id,
                        batchId,
                        result = $"Откат транзакции, состояние не изменено; {SummarizeException(ex)}",
                        sender = "backend",
                    },
                    correlationId: batchId);
                return Results.Json(
                    new { error = "Не удалось сохранить изменения расписания" },
                    statusCode: StatusCodes.Status500InternalServerError);
            }

            supervisor.Nudge();
            PublishBatchSuccess(notifications, id, connection.Name, batchId, kind, request.Items ?? [], result);

            return Results.Ok(new ScheduleBatchResultDto(
                true,
                result.Applied.Select(ToScheduleRuleDto).ToList(),
                result.SupersededIds));
        });

        // Бэклог — из тёплого ring-buffer (Publish пишет синхронно; после рестарта буфер гидрируется
        // из БД, см. NotificationPersistWriter). Долговременный лог пишется асинхронно и служит аудитом.
        api.MapGet("/notifications", (NotificationHub hub, int? limit) =>
            hub.List(limit is > 0 and <= 500 ? limit : 100));

        // Журнал инцидентов (phase 11.13c). Не NC-лента: строки таблицы incident в OHS.
        api.MapGet("/incidents", async (
            string? module,
            string? status,
            string? type,
            long? connectionId,
            DateTimeOffset? from,
            DateTimeOffset? to,
            int? limit,
            IIncidentStore store,
            TimeProvider time,
            CancellationToken ct) =>
        {
            var rows = await store.QueryAsync(
                new IncidentQuery
                {
                    Module = module,
                    Status = status,
                    Type = type,
                    ConnectionId = connectionId,
                    From = from,
                    To = to,
                    Limit = limit ?? 100,
                },
                ct).ConfigureAwait(false);
            var now = time.GetUtcNow();
            return rows.Select(i => ToIncidentDto(i, now)).ToList();
        });

        api.MapGet("/incidents/{corrUid}", async (
            string corrUid,
            IIncidentStore store,
            TimeProvider time,
            CancellationToken ct) =>
        {
            var row = await store.GetAsync(Uri.UnescapeDataString(corrUid), ct).ConfigureAwait(false);
            return row is null
                ? Results.NotFound()
                : Results.Ok(ToIncidentDto(row, time.GetUtcNow()));
        });

        // 11.13f: оператор закрывает эпизод журнала → abandoned_manual (+ Manager/Hub, если live break).
        api.MapPost("/incidents/{corrUid}/resolve", async (
            string corrUid,
            ResolveIncidentRequest? request,
            IIncidentStore store,
            ConnectionManager manager,
            IIncidentFanOut fanOut,
            TimeProvider time,
            CancellationToken ct) =>
        {
            var corr = Uri.UnescapeDataString(corrUid);
            var row = await store.GetAsync(corr, ct).ConfigureAwait(false);
            if (row is null)
            {
                return Results.NotFound(new { error = $"Инцидент {corr} не найден" });
            }

            var now = time.GetUtcNow();
            var resolvedBy = string.IsNullOrWhiteSpace(request?.ResolvedBy)
                ? NotificationHub.Superuser.Id
                : request!.ResolvedBy!.Trim();

            if (row.Status == "resolved")
            {
                await store.AnnotateResolvedByAsync(corr, resolvedBy, ct).ConfigureAwait(false);
                var again = await store.GetAsync(corr, ct).ConfigureAwait(false);
                return Results.Ok(ToIncidentDto(again ?? row, now));
            }

            var closedViaManager = false;
            if (row is { Module: "connection", Type: "break", ConnectionId: { } connId }
                && manager.GetIncidentSince(connId) is not null)
            {
                // I13: Manager SoT; Hub corr не гейтит. Совпадение corr — если Manager его помнит.
                var managerCorr = manager.GetOpenBreakCorr(connId);
                if (managerCorr is null
                    || string.Equals(managerCorr, corr, StringComparison.Ordinal))
                {
                    closedViaManager = await manager
                        .TryAbandonIncidentByManualAsync(connId, now, ct)
                        .ConfigureAwait(false);
                    if (closedViaManager)
                    {
                        await store.AnnotateResolvedByAsync(corr, resolvedBy, ct).ConfigureAwait(false);
                    }
                }
            }

            if (!closedViaManager)
            {
                // Журнал напрямую (не SafeAsync) — ошибка БД = 500; NC — fan-out SkipJournal.
                var ok = await store
                    .ResolveAsync(
                        corr,
                        now,
                        NotificationThreadData.OutcomeAbandonedManual,
                        title: null,
                        severity: "warning",
                        resolvedBy,
                        ct)
                    .ConfigureAwait(false);
                if (!ok)
                {
                    return Results.Conflict(new { error = $"Не удалось закрыть {corr}" });
                }

                if (!string.IsNullOrWhiteSpace(row.Subject))
                {
                    await fanOut
                        .ApplyAsync(
                            new IncidentStep(
                                IncidentStepKind.Resolve,
                                row.Subject!,
                                now,
                                CorrUid: corr,
                                ConnectionId: row.ConnectionId,
                                CloseOutcome: NotificationThreadData.OutcomeAbandonedManual,
                                Severity: "warning",
                                ResolvedBy: resolvedBy,
                                NcCode: "connection.incident_closed",
                                NcMessage: string.IsNullOrWhiteSpace(row.Title)
                                    ? "Инцидент закрыт вручную (журнал)"
                                    : $"{row.Title}: закрыт вручную",
                                NcSeverity: "warning",
                                NcData: new
                                {
                                    connectionId = row.ConnectionId,
                                    kind = row.Type,
                                    reason = "manual_journal",
                                    sender = "user",
                                    closeOutcome = NotificationThreadData.OutcomeAbandonedManual,
                                    resolvedBy,
                                },
                                SkipJournal: true),
                            ct)
                        .ConfigureAwait(false);
                }
            }

            var updated = await store.GetAsync(corr, ct).ConfigureAwait(false);
            return updated is null
                ? Results.NotFound()
                : Results.Ok(ToIncidentDto(updated, now));
        });

        // I13: seed Hub/Manager session из journal open breaks (не V025→journal).
        api.MapPost("/incidents/backfill-open", async (
            IConnectionStore connections,
            IIncidentStore store,
            ConnectionManager manager,
            INotificationPublisher notifications,
            IIncidentFanOut fanOut,
            CancellationToken ct) =>
        {
            var adopted = 0;
            var skipped = 0;
            var failed = 0;
            foreach (var connection in await connections.ListAsync(ct).ConfigureAwait(false))
            {
                Incident? row;
                try
                {
                    row = await store
                        .FindOpenBreakAsync(connection.ConnectionId, ct)
                        .ConfigureAwait(false);
                }
                catch
                {
                    failed++;
                    continue;
                }

                if (row is null)
                {
                    skipped++;
                    continue;
                }

                try
                {
                    var open = OpenLinkIncident.FromJournal(row);
                    var subject = ConnectionManager.LinkIncidentSubject(connection.ConnectionId);
                    if (manager.GetIncidentSince(connection.ConnectionId) is null)
                    {
                        _ = manager.AdoptOpenIncident(
                            connection.ConnectionId,
                            open.OpenedAt,
                            owner: row.Owner ?? "supervisor",
                            corrUid: open.CorrelationId);
                    }

                    _ = notifications.Adopt(subject, open.CorrelationId, open.Status);
                    await fanOut
                        .ApplyAsync(
                            new IncidentStep(
                                IncidentStepKind.Adopt,
                                subject,
                                open.OpenedAt,
                                CorrUid: open.CorrelationId,
                                ConnectionId: connection.ConnectionId,
                                Owner: row.Owner ?? "supervisor",
                                SourceId: connection.SourceId,
                                HubStatus: open.Status),
                            ct)
                        .ConfigureAwait(false);
                    adopted++;
                }
                catch
                {
                    failed++;
                }
            }

            return Results.Ok(new BackfillOpenIncidentsResultDto(adopted, skipped, failed));
        });

        // J4 scoped: gaps link_liveness за вчера+сегодня (МСК) → incident (идемпотентно).
        api.MapPost("/incidents/backfill-recent", async (
            IConnectionStore connections,
            ILinkLivenessStore linkLiveness,
            IIncidentStore store,
            TimeProvider time,
            CancellationToken ct) =>
        {
            var (fromUtc, toUtc) = IncidentRecentBackfill.WindowUtc(time.GetUtcNow());
            var inserted = 0;
            var skipped = 0;
            var failed = 0;

            foreach (var connection in await connections.ListAsync(ct).ConfigureAwait(false))
            {
                IReadOnlyList<LinkGap> gaps;
                IReadOnlyList<Incident> existing;
                try
                {
                    gaps = await linkLiveness
                        .QueryGapsAsync([connection.SourceId], fromUtc, toUtc, ct)
                        .ConfigureAwait(false);
                    existing = await store
                        .QueryAsync(
                            new IncidentQuery
                            {
                                Module = "connection",
                                ConnectionId = connection.ConnectionId,
                                From = fromUtc,
                                To = toUtc,
                                Limit = 1000,
                            },
                            ct)
                        .ConfigureAwait(false);
                }
                catch
                {
                    failed++;
                    continue;
                }

                foreach (var gap in gaps)
                {
                    var mapped = IncidentRecentBackfill.TryMap(
                        connection.ConnectionId, gap, fromUtc, toUtc);
                    if (mapped is null)
                    {
                        skipped++;
                        continue;
                    }

                    if (IncidentRecentBackfill.OverlapsExisting(existing, gap))
                    {
                        skipped++;
                        continue;
                    }

                    try
                    {
                        var wrote = await store.OpenAsync(mapped, ct).ConfigureAwait(false);
                        if (wrote)
                        {
                            inserted++;
                            existing = [.. existing, mapped];
                        }
                        else
                        {
                            skipped++;
                        }
                    }
                    catch
                    {
                        failed++;
                    }
                }
            }

            return Results.Ok(new BackfillRecentIncidentsResultDto(inserted, skipped, failed, fromUtc, toUtc));
        });

        api.MapGet("/connections/{id:long}/incidents", async (
            long id,
            DateTimeOffset? from,
            DateTimeOffset? to,
            int? limit,
            IIncidentStore store,
            TimeProvider time,
            CancellationToken ct) =>
        {
            var rows = await store.QueryAsync(
                new IncidentQuery
                {
                    ConnectionId = id,
                    From = from,
                    To = to,
                    Limit = limit ?? 500,
                },
                ct).ConfigureAwait(false);
            var now = time.GetUtcNow();
            return rows.Select(i => ToIncidentDto(i, now)).ToList();
        });

        // Heads-up барьеру старта супервизора (7j.20): клиент на реконнекте WS сообщает «у меня открыт
        // инцидент простоя — держи Auto, пока не пришлю backend.recovered» + corr этого инцидента (§9.2),
        // чтобы `ohs.unhandled` во время recovery штамповался в ту же нить. Ничего не персистит.
        api.MapPost("/recovery/hold", (HoldRecoveryRequest? req, ClientRecoveryGate recoveryGate) =>
        {
            recoveryGate.Hold();
            recoveryGate.SetActiveIncident(req?.CorrelationId);
            return Results.Accepted();
        });

        // Mock-POST внешнего NC (7j.20): клиент публикует уже сформированное событие с собственным id и,
        // возможно, ПРОШЛЫМ ts (backdated) — напр. недоступность бэка детектит клиент, а POST уходит по
        // реконнекту. Сейчас пишем в тот же хаб/аудит-лог; позже тот же контракт уйдёт во внешний сервис.
        api.MapPost("/notifications", (
            IngestNotificationRequest req,
            NotificationHub hub,
            ClientRecoveryGate recoveryGate) =>
        {
            if (string.IsNullOrWhiteSpace(req.Id)
                || string.IsNullOrWhiteSpace(req.Code)
                || string.IsNullOrWhiteSpace(req.Message))
            {
                return Results.BadRequest(new { error = "id, code, message обязательны" });
            }

            // id — системный Guid-формат «N» (аудит-лог персистит EventId как uuid). Не-Guid id иначе уронил
            // бы запись в лог, поэтому отвергаем на границе явным 400 (контракт mock внешнего NC).
            if (!Guid.TryParseExact(req.Id, "N", out _))
            {
                return Results.BadRequest(new { error = "id должен быть Guid в формате N (32 hex без дефисов)" });
            }

            // NC atom — Ingest (клиентский corr/ts). Crash journal — только Host fan-out
            // POST /recovery/outage (crash-dispatch D4); client backend.* в journal не пишет.
            hub.Ingest(
                req.Id,
                req.Ts,
                req.Code,
                req.Message,
                severity: string.IsNullOrWhiteSpace(req.Severity) ? "info" : req.Severity!,
                sourceType: string.IsNullOrWhiteSpace(req.SourceType) ? "system" : req.SourceType!,
                module: string.IsNullOrWhiteSpace(req.Module) ? "ohs.connection" : req.Module!,
                data: req.Data,
                status: req.Status,
                correlationId: req.CorrelationId);

            // 7j.20: recover клиента снимает стартовый барьер супервизора — Auto-реконнект пойдёт только
            // теперь, когда «Система восстановлена» уже в NC (порядок в ленте: recover → connecting). Плюс
            // снимаем штамп corr (§9.2): инцидент закрыт, следующие 500 — снова одиночные под requestId.
            // Journal resolve crash — слой C на /recovery/outage (не client backend.recovered).
            if (string.Equals(req.Code, "backend.recovered", StringComparison.Ordinal))
            {
                recoveryGate.Release();
                recoveryGate.ClearActiveIncident();
            }

            return Results.Accepted();
        });

        api.MapGet("/connections", async (IConnectionStore store, ConnectionManager manager, CancellationToken ct) =>
        {
            var connections = await store.ListAsync(ct);
            return connections.Select(c => ToDto(c, manager.GetStatus(c.ConnectionId))).ToList();
        });

        // После outage/сна: клиент спрашивает, есть ли Auto×N stop + open break в окне → Single INFO.
        api.MapGet("/connections/needs-operator", async (
            ConnectionSupervisor supervisor,
            CancellationToken ct) =>
            await supervisor.ListNeedsOperatorAsync(ct).ConfigureAwait(false));

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

        // DEV-only: тест exception-middleware (7j.20 §6.1). Бросает ОБЫЧНОЕ исключение (не
        // BadHttpRequestException) → GlobalExceptionHandler публикует `ohs.unhandled` (critical). Дёрнуть в
        // окне recovery инцидента простоя (убить бэк → он откроется на фронте → рестарт → в первые секунды
        // подъёма GET /api/test-exception) — фронт должен втянуть этот FATAL в стек инцидента и НЕ закрыть
        // его, пока не стабилизируется. В проде — 404.
        api.MapGet("/test-exception", (IWebHostEnvironment env) =>
        {
            if (!env.IsDevelopment())
            {
                return Results.NotFound();
            }
            throw new InvalidOperationException("Is the test exception-middleware");
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
            ILinkLivenessStore linkLiveness,
            INotificationPublisher notifications,
            IIncidentFanOut fanOut,
            RecordingSupervisor recordingSupervisor,
            CancellationToken ct) =>
        {
            var connection = await store.GetAsync(id, ct);
            if (connection is null)
            {
                return Results.NotFound(new { error = $"Подключение {id} не найдено" });
            }

            var userLabel = ConnectionManager.ConnLabelUser(id, connection.Name);
            var systemLabel = ConnectionManager.ConnLabelSystem(id);
            var linkSubject = ConnectionManager.LinkIncidentSubject(id);
            // Открытый break → вся ручная попытка в ТОТ ЖЕ link-corr (не новый connect: «инцидент»).
            var breakOpen = manager.GetIncidentSince(id) is not null;

            if (breakOpen)
            {
                notifications.Append(
                    linkSubject,
                    "connection.connect",
                    $"{userLabel}: подключение по команде оператора",
                    severity: "info",
                    sourceType: "user",
                    data: new { connectionId = id, sender = "user" });
                await fanOut
                    .ApplyAsync(
                        new IncidentStep(
                            IncidentStepKind.Recovering,
                            linkSubject,
                            DateTimeOffset.UtcNow,
                            ConnectionId: id,
                            NcCode: "connection.reconnecting",
                            NcMessage: $"{userLabel}: восстановление связи по команде оператора…",
                            NcSeverity: "warning",
                            NcData: new { connectionId = id, owner = "supervisor", sender = "user" }),
                        ct)
                    .ConfigureAwait(false);

                try
                {
                    var connect = await manager.ConnectAsync(id, ct);
                    // recovered пишет ConnectAsync → CloseIncidentAsync в link-corr.
                    recordingSupervisor.Nudge();
                    return Results.Ok(ToDto(connection, connect.Status));
                }
                catch (InvalidOperationException ex)
                {
                    var (failedMessage, failedData) = ConnectionManager.FormatConnectFailedNotification(id, systemLabel, ex.Message);
                    notifications.Append(
                        linkSubject,
                        "connection.connect_failed",
                        failedMessage,
                        severity: "error",
                        data: failedData);
                    return Results.BadRequest(new { error = ex.Message });
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    var (failedMessage, failedData) = ConnectionManager.FormatConnectFailedNotification(id, systemLabel, ex.Message);
                    notifications.Append(
                        linkSubject,
                        "connection.connect_failed",
                        failedMessage,
                        severity: "error",
                        data: failedData);
                    throw;
                }
            }

            // I11: нет open break — user intent без corr; Group connect: только после успеха.
            // Fail → Open link: Incident (без throwaway connect: Group).
            notifications.Publish(
                "connection.connect",
                $"{userLabel}: подключение по команде оператора",
                severity: "info", sourceType: "user", data: new { connectionId = id });

            var previous = await linkLiveness.GetLastAsync(connection.SourceId, ct);

            try
            {
                var connect = await manager.ConnectAsync(id, ct);
                var attempt = $"connection:{id}:connect:{Guid.NewGuid().ToString("N")[..8]}";
                var readyAt = connect.ReadyAt;
                notifications.Publish(
                    "connection.connecting",
                    $"{systemLabel}: устанавливаю связь…",
                    severity: "warning", sourceType: "system", status: "underway", correlationId: attempt,
                    data: new { connectionId = id, threadKindHint = NotificationThreadData.KindGroup },
                    ts: readyAt);
                notifications.Publish(
                    "connection.connected",
                    $"{systemLabel}: связь установлена.",
                    severity: "ok", sourceType: "system", status: "resolved", correlationId: attempt,
                    data: NotificationThreadData.WithHints(
                        ConnectionManager.FormatConnectedNotificationData(id, previous, sender: "backend"),
                        threadKindHint: NotificationThreadData.KindGroup),
                    ts: readyAt);
                recordingSupervisor.Nudge();
                return Results.Ok(ToDto(connection, connect.Status));
            }
            catch (InvalidOperationException ex)
            {
                var (failedMessage, failedData) = ConnectionManager.FormatConnectFailedNotification(id, systemLabel, ex.Message);
                manager.EnsureBreakIncidentOnConnectFailure(id, DateTimeOffset.UtcNow, systemLabel);
                notifications.Append(
                    linkSubject,
                    "connection.connect_failed",
                    failedMessage,
                    severity: "error",
                    data: failedData);
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                var (failedMessage, failedData) = ConnectionManager.FormatConnectFailedNotification(id, systemLabel, ex.Message);
                manager.EnsureBreakIncidentOnConnectFailure(id, DateTimeOffset.UtcNow, systemLabel);
                notifications.Append(
                    linkSubject,
                    "connection.connect_failed",
                    failedMessage,
                    severity: "error",
                    data: failedData);
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
            await schedule.SetAutoAsync(id, false, ct);
            supervisor.Nudge();

            var status = await manager.DisconnectAsync(id, ct);
            var connection = await store.GetAsync(id, ct);
            if (connection is null)
            {
                return Results.NotFound(new { error = $"Подключение {id} не найдено" });
            }

            // J11b / I11: close-break в Manager+Hub вместе (не голый Hub.Resolve — иначе _incidentSince висит).
            var userLabel = ConnectionManager.ConnLabelUser(id, connection.Name);
            await manager.TryAbandonIncidentByManualAsync(id, DateTimeOffset.UtcNow, ct).ConfigureAwait(false);
            notifications.Publish(
                "connection.disconnect",
                $"{userLabel}: отключение по команде оператора",
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

    private static ConnectionScheduleRuleDraft ToRuleDraft(PutConnectionScheduleRuleRequest request)
    {
        var scope = (request.ScopeKind ?? "").Trim().ToLowerInvariant();
        var mode = (request.Mode ?? "").Trim().ToLowerInvariant();
        var open = string.IsNullOrWhiteSpace(request.Open) ? (TimeOnly?)null : ParseScheduleTime(request.Open!);
        var source = string.IsNullOrWhiteSpace(request.ChangeSource) ? "ui" : request.ChangeSource.Trim();

        return new ConnectionScheduleRuleDraft
        {
            ScopeKind = scope,
            DowMask = request.DowMask,
            DateFrom = request.DateFrom,
            DateTo = request.DateTo,
            Mode = mode,
            OpenTime = open,
            DurationMin = request.DurationMin,
            ChangeSource = source,
            ChangeNote = request.ChangeNote,
        };
    }

    private static TimeOnly ParseScheduleTime(string text)
    {
        if (TimeOnly.TryParse(text, System.Globalization.CultureInfo.InvariantCulture, out var t))
        {
            return t;
        }

        throw new ArgumentException($"Некорректное время: {text}");
    }

    private static readonly string[] _batchFailedUserLines =
    [
        "Изменения не применены — ошибка хранилища",
        "Повторите попытку; при повторной ошибке — обратитесь к администратору",
    ];

    private static readonly string[] _settingsFailedUserLines =
    [
        "Настройка не сохранена — ошибка хранилища",
        "Повторите попытку; при повторной ошибке — обратитесь к администратору",
    ];

    /// <summary>User-подпись расписания: id основной, имя в скобках (имя может меняться).</summary>
    private static string ScheduleWho(long connectionId, string name) => $"Расписание {connectionId} («{name}»)";

    /// <summary>Краткая суть исключения для NC/аудита (тип + message, усечение ≤500). Полный стек — только в логе.</summary>
    private static string SummarizeException(Exception ex)
    {
        var summary = $"{ex.GetType().FullName}: {ex.Message}";
        return summary.Length > 500 ? summary[..500] + "…" : summary;
    }

    /// <summary>Сводка успешной пачки: user·info (заголовок + lines) + system·info batch, общий correlationId.</summary>
    private static void PublishBatchSuccess(
        INotificationPublisher notifications,
        long id,
        string name,
        string batchId,
        string kind,
        IReadOnlyList<ScheduleComposeItemDto> requestItems,
        ScheduleBatchResult result)
    {
        // Backfill scheduleId в 'set'-items из applied (порядок set-items ↔ порядок применённых upsert'ов).
        var appliedIds = result.Applied.Select(r => r.ScheduleId).ToList();
        var next = 0;
        var items = requestItems
            .Select(it => it.Kind.Equals("set", StringComparison.OrdinalIgnoreCase)
                    && it.ScheduleId is null && next < appliedIds.Count
                ? it with { ScheduleId = appliedIds[next++] }
                : it)
            .ToList();

        var n = items.Count;
        var headline = kind switch
        {
            "cleared" => n > 0 ? $"{ScheduleWho(id, name)}: сброшено ({n})" : $"{ScheduleWho(id, name)}: сброшено",
            "recreated" => n > 0 ? $"{ScheduleWho(id, name)}: пересоздано ({n})" : $"{ScheduleWho(id, name)}: пересоздано",
            _ => n > 0 ? $"{ScheduleWho(id, name)}: изменено ({n})" : $"{ScheduleWho(id, name)}: изменено",
        };

        // lines без тавтологии «Расписание N:» (id уже в заголовке).
        var lines = items
            .Select(it =>
            {
                var verb = it.Kind.Equals("canceled", StringComparison.OrdinalIgnoreCase) ? "снято"
                    : it.Kind.Equals("set", StringComparison.OrdinalIgnoreCase) ? "утверждено"
                    : it.Kind;
                return $"Правило «{it.Label}» {verb}";
            })
            .ToList();

        var userCode = kind switch
        {
            "cleared" => "connection.schedule.cleared",
            "recreated" => "connection.schedule.recreated",
            _ => "connection.schedule.batch_applied",
        };

        // Симметрия состояния расписания: очистка → пустое (warning); пересоздание из пустого →
        // расписание появилось (ok, позитивный переход); правка существующего → рутинный info.
        var userSeverity = kind switch
        {
            "cleared" => "warning",
            "recreated" => "ok",
            _ => "info",
        };

        // User = active (намерение), system = resolved (факт применён) → Thread RESOLVED.
        notifications.Publish(
            userCode,
            headline,
            severity: userSeverity, sourceType: "user",
            status: "active",
            data: NotificationThreadData.WithHints(
                new { connectionId = id, batchId, kind, items, lines },
                threadKindHint: NotificationThreadData.KindGroup),
            correlationId: batchId);

        // System — техаудит: только id (имя опускаем, оно для user-ленты).
        var systemHeadline = kind switch
        {
            "cleared" => $"Расписание {id}: сброшено batch ({n})",
            "recreated" => $"Расписание {id}: пересоздано batch ({n})",
            _ => $"Расписание {id}: изменено batch ({n})",
        };
        notifications.Publish(
            "connection.schedule.batch",
            systemHeadline,
            severity: "info", sourceType: "system",
            status: "resolved",
            data: NotificationThreadData.WithHints(
                new { connectionId = id, batchId, kind, items },
                threadKindHint: NotificationThreadData.KindGroup),
            correlationId: batchId);
    }

    private static ConnectionScheduleStateDto ToScheduleStateDto(ConnectionScheduleState state) => new(
        ToScheduleSettingsDto(state.Settings),
        state.LiveRules.Select(ToScheduleRuleDto).ToList());

    private static ConnectionScheduleSettingsDto ToScheduleSettingsDto(ConnectionScheduleSettings s) => new(
        s.ConnectionId, s.AutoEnabled, s.Engine, s.Tz);

    private static ConnectionScheduleRuleDto ToScheduleRuleDto(ConnectionScheduleRule r)
    {
        string? open = null;
        string? end = null;
        if (r is { OpenTime: { } o, DurationMin: { } dur })
        {
            open = o.ToString("HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture);
            var endMinutes = ((int)o.ToTimeSpan().TotalMinutes + dur) % 1440;
            end = TimeOnly.FromTimeSpan(TimeSpan.FromMinutes(endMinutes))
                .ToString("HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture);
        }

        return new ConnectionScheduleRuleDto(
            r.ScheduleId,
            r.ConnectionId,
            r.ScopeKind,
            r.DowMask,
            r.DateFrom,
            r.DateTo,
            r.Mode,
            open,
            r.DurationMin,
            end,
            r.EffectiveFrom,
            r.EffectiveTo,
            r.CloseReason,
            r.ChangeSource,
            r.ChangeNote);
    }

    private static ConnectionDto ToDto(ConnectorConnection connection, string status) => new(
        connection.ConnectionId, connection.SourceId, connection.Name, connection.Kind, connection.Settings,
        connection.Enabled, status);

    /// <summary>DTO журнала: <c>durationMs = (closedAt ?? now) − openedAt</c>.</summary>
    public static IncidentDto ToIncidentDto(Incident incident, DateTimeOffset nowUtc)
    {
        var end = incident.ClosedAt ?? nowUtc;
        var durationMs = Math.Max(0, (long)(end - incident.OpenedAt).TotalMilliseconds);
        return new IncidentDto(
            incident.CorrUid,
            incident.Module,
            incident.Type,
            incident.Status,
            incident.CloseOutcome,
            incident.OpenedAt,
            incident.ClosedAt,
            incident.Subject,
            incident.Severity,
            incident.Title,
            incident.LastActivityAt,
            incident.ConnectionId,
            incident.SourceId,
            incident.EscalatedAt,
            incident.Subtype,
            incident.Owner,
            incident.Payload,
            durationMs,
            ReadResolvedBy(incident.Payload));
    }

    private static string? ReadResolvedBy(string? payload)
    {
        if (string.IsNullOrWhiteSpace(payload))
        {
            return null;
        }

        try
        {
            using var doc = JsonDocument.Parse(payload);
            return doc.RootElement.TryGetProperty("resolvedBy", out var p)
                   && p.ValueKind == JsonValueKind.String
                ? p.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

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
        LinkCloseReason.Scheduled => "scheduled",
        LinkCloseReason.Degraded => "degraded",
        _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
    };

}
