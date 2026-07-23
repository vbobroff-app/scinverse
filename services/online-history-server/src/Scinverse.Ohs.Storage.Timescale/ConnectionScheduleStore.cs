using System.Globalization;
using Dapper;
using Npgsql;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>Расписание соединений (connection_schedule / _settings), phase 7j v2.</summary>
public sealed class ConnectionScheduleStore(NpgsqlDataSource dataSource) : IConnectionScheduleStore
{
    private const string DefaultEngine = "futures";
    private const string DefaultTz = "Europe/Moscow";

    private const string SelectRuleSql = """
        SELECT schedule_id AS ScheduleId,
               connection_id AS ConnectionId,
               scope_kind AS ScopeKind,
               dow_mask AS DowMask,
               date_from AS DateFrom,
               date_to AS DateTo,
               mode AS Mode,
               open_time::text AS OpenTimeText,
               duration_min AS DurationMin,
               effective_from AS EffectiveFrom,
               effective_to AS EffectiveTo,
               close_reason AS CloseReason,
               change_source AS ChangeSource,
               change_note AS ChangeNote
        FROM connection_schedule
        """;

    private const string SelectSettingsSql = """
        SELECT connection_id AS ConnectionId,
               auto_enabled AS AutoEnabled,
               engine AS Engine,
               tz AS Tz
        FROM connection_schedule_settings
        """;

    public async Task<ConnectionScheduleState> GetStateAsync(
        long connectionId, CancellationToken cancellationToken)
    {
        var settings = await GetSettingsAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var rules = await ListLiveRulesAsync(connectionId, cancellationToken).ConfigureAwait(false);
        return new ConnectionScheduleState { Settings = settings, LiveRules = rules };
    }

    public async Task<ConnectionScheduleSettings> GetSettingsAsync(
        long connectionId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<SettingsRow>(new CommandDefinition(
            SelectSettingsSql + " WHERE connection_id = @connectionId;",
            new { connectionId },
            cancellationToken: cancellationToken));
        return row is null ? DefaultSettings(connectionId) : MapSettings(row);
    }

    public async Task<IReadOnlyList<ConnectionScheduleRule>> ListLiveRulesAsync(
        long connectionId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<RuleRow>(new CommandDefinition(
            SelectRuleSql + " WHERE connection_id = @connectionId AND effective_to IS NULL ORDER BY scope_kind, effective_from DESC;",
            new { connectionId },
            cancellationToken: cancellationToken));
        return rows.Select(MapRule).ToList();
    }

    public async Task<IReadOnlyList<ConnectionScheduleRule>> ListHistoryAsync(
        long connectionId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<RuleRow>(new CommandDefinition(
            SelectRuleSql + " WHERE connection_id = @connectionId ORDER BY effective_from DESC, schedule_id DESC;",
            new { connectionId },
            cancellationToken: cancellationToken));
        return rows.Select(MapRule).ToList();
    }

    public async Task<IReadOnlyList<ConnectionScheduleState>> ListAutoEnabledAsync(
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        var settings = (await connection.QueryAsync<SettingsRow>(new CommandDefinition(
            SelectSettingsSql + " WHERE auto_enabled = TRUE ORDER BY connection_id;",
            cancellationToken: cancellationToken))).Select(MapSettings).ToList();

        if (settings.Count == 0)
        {
            return [];
        }

        var ids = settings.Select(s => s.ConnectionId).ToArray();
        var rules = (await connection.QueryAsync<RuleRow>(new CommandDefinition(
            SelectRuleSql + " WHERE connection_id = ANY(@ids) AND effective_to IS NULL;",
            new { ids },
            cancellationToken: cancellationToken))).Select(MapRule).ToList();

        var byConnection = rules.GroupBy(r => r.ConnectionId).ToDictionary(g => g.Key, g => (IReadOnlyList<ConnectionScheduleRule>)g.ToList());

        return settings.Select(s => new ConnectionScheduleState
        {
            Settings = s,
            LiveRules = byConnection.GetValueOrDefault(s.ConnectionId, []),
        }).ToList();
    }

    public async Task<UpsertRuleResult> UpsertRuleAsync(
        long connectionId, ConnectionScheduleRuleDraft draft, CancellationToken cancellationToken)
    {
        Validate(draft);

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);

        var now = DateTimeOffset.UtcNow;
        var (rule, supersededIds) = await ApplyUpsertAsync(connection, tx, connectionId, draft, now, cancellationToken);

        await tx.CommitAsync(cancellationToken);
        return new UpsertRuleResult(rule, supersededIds);
    }

    public async Task<ScheduleBatchResult> ApplyBatchAsync(
        long connectionId,
        IReadOnlyList<ConnectionScheduleRuleDraft> upserts,
        IReadOnlyList<long> cancels,
        CancellationToken cancellationToken)
    {
        // Валидируем все черновики ДО открытия транзакции (ArgumentException → 400 без частичной работы).
        foreach (var draft in upserts)
        {
            Validate(draft);
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);

        var now = DateTimeOffset.UtcNow;
        var applied = new List<ConnectionScheduleRule>(upserts.Count);
        var supersededIds = new List<long>();
        var canceledIds = new List<long>(cancels.Count);

        foreach (var draft in upserts)
        {
            var (rule, superseded) = await ApplyUpsertAsync(connection, tx, connectionId, draft, now, cancellationToken);
            applied.Add(rule);
            supersededIds.AddRange(superseded);
        }

        foreach (var scheduleId in cancels)
        {
            var affected = await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE connection_schedule
                SET effective_to = @now, close_reason = 'canceled'
                WHERE connection_id = @connectionId AND schedule_id = @scheduleId AND effective_to IS NULL;
                """,
                new { connectionId, scheduleId, now },
                transaction: tx,
                cancellationToken: cancellationToken));

            // 0 строк — правило уже закрыто (например, перекрыто upsert'ом в этой же пачке) → no-op.
            if (affected > 0)
            {
                canceledIds.Add(scheduleId);
            }
        }

        await tx.CommitAsync(cancellationToken);
        return new ScheduleBatchResult(applied, supersededIds, canceledIds);
    }

    /// <summary>SCD-2 supersede + insert новой версии в рамках переданной транзакции (без commit).</summary>
    private static async Task<(ConnectionScheduleRule Rule, IReadOnlyList<long> SupersededIds)> ApplyUpsertAsync(
        Npgsql.NpgsqlConnection connection,
        System.Data.Common.DbTransaction tx,
        long connectionId,
        ConnectionScheduleRuleDraft draft,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        // Закрываем как superseded все живые правила того же уровня, чей скоуп ⊆ нового.
        var supersededIds = (await connection.QueryAsync<long>(new CommandDefinition(
            SupersedeSql(draft.ScopeKind),
            new
            {
                connectionId,
                now,
                mask = draft.DowMask,
                dateFrom = draft.DateFrom,
                dateTo = draft.DateTo,
            },
            transaction: tx,
            cancellationToken: cancellationToken))).ToList();

        var inserted = await connection.QuerySingleAsync<RuleRow>(new CommandDefinition(
            InsertRuleSql,
            new
            {
                connectionId,
                scopeKind = draft.ScopeKind,
                mask = draft.DowMask,
                dateFrom = draft.DateFrom,
                dateTo = draft.DateTo,
                mode = draft.Mode,
                openTime = draft.OpenTime is { } o ? FormatTime(o) : null,
                durationMin = draft.DurationMin,
                now,
                changeSource = draft.ChangeSource,
                changeNote = draft.ChangeNote,
            },
            transaction: tx,
            cancellationToken: cancellationToken));

        // Инсертнутое правило не должно попадать в список superseded.
        supersededIds.Remove(inserted.ScheduleId);
        return (MapRule(inserted), supersededIds);
    }

    private const string InsertRuleSql = """
        INSERT INTO connection_schedule (
            connection_id, scope_kind, dow_mask, date_from, date_to,
            mode, open_time, duration_min,
            effective_from, effective_to, close_reason, change_source, change_note)
        VALUES (
            @connectionId, @scopeKind, @mask, @dateFrom, @dateTo,
            @mode, @openTime::time, @durationMin,
            @now, NULL, NULL, @changeSource, @changeNote)
        RETURNING schedule_id AS ScheduleId,
                  connection_id AS ConnectionId,
                  scope_kind AS ScopeKind,
                  dow_mask AS DowMask,
                  date_from AS DateFrom,
                  date_to AS DateTo,
                  mode AS Mode,
                  open_time::text AS OpenTimeText,
                  duration_min AS DurationMin,
                  effective_from AS EffectiveFrom,
                  effective_to AS EffectiveTo,
                  close_reason AS CloseReason,
                  change_source AS ChangeSource,
                  change_note AS ChangeNote;
        """;

    public async Task<ConnectionScheduleRule?> CancelRuleAsync(
        long connectionId, long scheduleId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<RuleRow>(new CommandDefinition(
            """
            UPDATE connection_schedule
            SET effective_to = @now, close_reason = 'canceled'
            WHERE connection_id = @connectionId AND schedule_id = @scheduleId AND effective_to IS NULL
            RETURNING schedule_id AS ScheduleId,
                      connection_id AS ConnectionId,
                      scope_kind AS ScopeKind,
                      dow_mask AS DowMask,
                      date_from AS DateFrom,
                      date_to AS DateTo,
                      mode AS Mode,
                      open_time::text AS OpenTimeText,
                      duration_min AS DurationMin,
                      effective_from AS EffectiveFrom,
                      effective_to AS EffectiveTo,
                      close_reason AS CloseReason,
                      change_source AS ChangeSource,
                      change_note AS ChangeNote;
            """,
            new { connectionId, scheduleId, now = DateTimeOffset.UtcNow },
            cancellationToken: cancellationToken));
        return row is null ? null : MapRule(row);
    }

    public async Task<ConnectionScheduleSettings> SetSettingsAsync(
        long connectionId, bool? autoEnabled, string? engine, string? tz, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var row = await connection.QuerySingleAsync<SettingsRow>(new CommandDefinition(
            """
            INSERT INTO connection_schedule_settings (connection_id, auto_enabled, engine, tz, updated_at)
            VALUES (@connectionId, COALESCE(@auto, FALSE), COALESCE(@engine, 'futures'), COALESCE(@tz, 'Europe/Moscow'), now())
            ON CONFLICT (connection_id) DO UPDATE SET
                auto_enabled = COALESCE(@auto, connection_schedule_settings.auto_enabled),
                engine = COALESCE(@engine, connection_schedule_settings.engine),
                tz = COALESCE(@tz, connection_schedule_settings.tz),
                updated_at = now()
            RETURNING connection_id AS ConnectionId, auto_enabled AS AutoEnabled, engine AS Engine, tz AS Tz;
            """,
            new { connectionId, auto = autoEnabled, engine = Trimmed(engine), tz = Trimmed(tz) },
            cancellationToken: cancellationToken));
        return MapSettings(row);
    }

    public Task<ConnectionScheduleSettings> SetAutoAsync(
        long connectionId, bool autoEnabled, CancellationToken cancellationToken) =>
        SetSettingsAsync(connectionId, autoEnabled, null, null, cancellationToken);

    /// <summary>SQL закрытия вложенных живых правил того же уровня как superseded.</summary>
    private static string SupersedeSql(string scopeKind)
    {
        var predicate = scopeKind switch
        {
            ConnectionScheduleScopes.Main => "scope_kind = 'main'",
            // dow: закрываем те, чья маска полностью вложена в новую (Mold & Mnew = Mold).
            ConnectionScheduleScopes.Dow => "scope_kind = 'dow' AND (dow_mask & @mask) = dow_mask",
            // date: закрываем диапазоны, полностью содержащиеся в новом.
            ConnectionScheduleScopes.Date => "scope_kind = 'date' AND date_from >= @dateFrom AND date_to <= @dateTo",
            _ => throw new ArgumentException($"Неизвестный scope_kind: {scopeKind}", nameof(scopeKind)),
        };

        return $"""
            UPDATE connection_schedule
            SET effective_to = @now, close_reason = 'superseded'
            WHERE connection_id = @connectionId AND effective_to IS NULL AND {predicate}
            RETURNING schedule_id;
            """;
    }

    private static void Validate(ConnectionScheduleRuleDraft draft)
    {
        if (draft.ScopeKind is not (ConnectionScheduleScopes.Main or ConnectionScheduleScopes.Dow or ConnectionScheduleScopes.Date))
        {
            throw new ArgumentException($"Неизвестный scope_kind: {draft.ScopeKind}");
        }

        if (draft.Mode is not (ConnectionScheduleRuleModes.Window or ConnectionScheduleRuleModes.Off))
        {
            throw new ArgumentException($"Неизвестный mode: {draft.Mode}");
        }

        if (string.IsNullOrWhiteSpace(draft.ChangeSource))
        {
            throw new ArgumentException("changeSource обязателен");
        }

        switch (draft.ScopeKind)
        {
            case ConnectionScheduleScopes.Main:
                if (draft.DowMask is not null || draft.DateFrom is not null || draft.DateTo is not null)
                {
                    throw new ArgumentException("main не должен иметь dow_mask/date");
                }

                break;
            case ConnectionScheduleScopes.Dow:
                if (draft.DowMask is not { } mask || mask is < 1 or > 127)
                {
                    throw new ArgumentException("dow требует dow_mask в диапазоне 1..127");
                }

                break;
            case ConnectionScheduleScopes.Date:
                if (draft.DateFrom is not { } from || draft.DateTo is not { } to || to < from)
                {
                    throw new ArgumentException("date требует корректный диапазон date_from..date_to");
                }

                break;
        }

        if (draft.Mode == ConnectionScheduleRuleModes.Window)
        {
            if (draft.OpenTime is null || draft.DurationMin is not { } dur || dur is < 1 or > 1439)
            {
                throw new ArgumentException("window требует open_time и duration_min в диапазоне 1..1439");
            }
        }
    }

    private static string? Trimmed(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static ConnectionScheduleSettings DefaultSettings(long connectionId) => new()
    {
        ConnectionId = connectionId,
        AutoEnabled = false,
        Engine = DefaultEngine,
        Tz = DefaultTz,
    };

    private static string FormatTime(TimeOnly value) =>
        value.ToString("HH:mm:ss", CultureInfo.InvariantCulture);

    private static TimeOnly? ParseTime(string? text) =>
        string.IsNullOrWhiteSpace(text) ? null : TimeOnly.Parse(text, CultureInfo.InvariantCulture);

    private static ConnectionScheduleSettings MapSettings(SettingsRow row) => new()
    {
        ConnectionId = row.ConnectionId,
        AutoEnabled = row.AutoEnabled,
        Engine = row.Engine,
        Tz = row.Tz,
    };

    private static ConnectionScheduleRule MapRule(RuleRow row) => new()
    {
        ScheduleId = row.ScheduleId,
        ConnectionId = row.ConnectionId,
        ScopeKind = row.ScopeKind,
        DowMask = row.DowMask,
        DateFrom = row.DateFrom,
        DateTo = row.DateTo,
        Mode = row.Mode,
        OpenTime = ParseTime(row.OpenTimeText),
        DurationMin = row.DurationMin,
        EffectiveFrom = row.EffectiveFrom,
        EffectiveTo = row.EffectiveTo,
        CloseReason = row.CloseReason,
        ChangeSource = row.ChangeSource,
        ChangeNote = row.ChangeNote,
    };

    private sealed class RuleRow
    {
        public long ScheduleId { get; init; }
        public long ConnectionId { get; init; }
        public string ScopeKind { get; init; } = "";
        public int? DowMask { get; init; }
        public DateOnly? DateFrom { get; init; }
        public DateOnly? DateTo { get; init; }
        public string Mode { get; init; } = "";
        public string? OpenTimeText { get; init; }
        public int? DurationMin { get; init; }
        public DateTimeOffset EffectiveFrom { get; init; }
        public DateTimeOffset? EffectiveTo { get; init; }
        public string? CloseReason { get; init; }
        public string ChangeSource { get; init; } = "";
        public string? ChangeNote { get; init; }
    }

    private sealed class SettingsRow
    {
        public long ConnectionId { get; init; }
        public bool AutoEnabled { get; init; }
        public string Engine { get; init; } = "";
        public string Tz { get; init; } = "";
    }
}
