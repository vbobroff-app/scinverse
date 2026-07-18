using System.Globalization;
using Dapper;
using Npgsql;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>Расписание соединений (connection_schedule), phase 7j.</summary>
public sealed class ConnectionScheduleStore(NpgsqlDataSource dataSource) : IConnectionScheduleStore
{
    private const string SelectSql = """
        SELECT schedule_id AS ScheduleId,
               connection_id AS ConnectionId,
               mode AS Mode,
               window_start::text AS WindowStartText,
               window_end::text AS WindowEndText,
               engine AS Engine,
               tz AS Tz,
               effective_from AS EffectiveFrom,
               effective_to AS EffectiveTo,
               change_source AS ChangeSource,
               change_note AS ChangeNote
        FROM connection_schedule
        """;

    public async Task<ConnectionScheduleEntry?> GetCurrentAsync(
        long connectionId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<Row>(new CommandDefinition(
            SelectSql + " WHERE connection_id = @connectionId AND effective_to IS NULL;",
            new { connectionId },
            cancellationToken: cancellationToken));
        return row is null ? null : Map(row);
    }

    public async Task<IReadOnlyList<ConnectionScheduleEntry>> ListCurrentScheduledAsync(
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            SelectSql + " WHERE effective_to IS NULL AND mode = 'scheduled' ORDER BY connection_id;",
            cancellationToken: cancellationToken));
        return rows.Select(Map).ToList();
    }

    public async Task<IReadOnlyList<ConnectionScheduleEntry>> ListHistoryAsync(
        long connectionId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            SelectSql + " WHERE connection_id = @connectionId ORDER BY effective_from DESC;",
            new { connectionId },
            cancellationToken: cancellationToken));
        return rows.Select(Map).ToList();
    }

    public async Task<ConnectionScheduleEntry> PublishWindowAsync(
        long connectionId,
        string mode,
        TimeOnly windowStart,
        TimeOnly windowEnd,
        string engine,
        string tz,
        string changeSource,
        string? changeNote,
        CancellationToken cancellationToken)
    {
        ValidateMode(mode);
        if (string.IsNullOrWhiteSpace(engine))
        {
            throw new ArgumentException("engine обязателен", nameof(engine));
        }

        if (string.IsNullOrWhiteSpace(tz))
        {
            throw new ArgumentException("tz обязателен", nameof(tz));
        }

        if (string.IsNullOrWhiteSpace(changeSource))
        {
            throw new ArgumentException("changeSource обязателен", nameof(changeSource));
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);

        var now = DateTimeOffset.UtcNow;
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE connection_schedule
            SET effective_to = @now
            WHERE connection_id = @connectionId AND effective_to IS NULL;
            """,
            new { connectionId, now },
            transaction: tx,
            cancellationToken: cancellationToken));

        var row = await connection.QuerySingleAsync<Row>(new CommandDefinition(
            """
            INSERT INTO connection_schedule (
                connection_id, mode, window_start, window_end, engine, tz,
                effective_from, effective_to, change_source, change_note)
            VALUES (
                @connectionId, @mode, @windowStart::time, @windowEnd::time, @engine, @tz,
                @now, NULL, @changeSource, @changeNote)
            RETURNING schedule_id AS ScheduleId,
                      connection_id AS ConnectionId,
                      mode AS Mode,
                      window_start::text AS WindowStartText,
                      window_end::text AS WindowEndText,
                      engine AS Engine,
                      tz AS Tz,
                      effective_from AS EffectiveFrom,
                      effective_to AS EffectiveTo,
                      change_source AS ChangeSource,
                      change_note AS ChangeNote;
            """,
            new
            {
                connectionId,
                mode,
                windowStart = FormatTime(windowStart),
                windowEnd = FormatTime(windowEnd),
                engine,
                tz,
                now,
                changeSource,
                changeNote,
            },
            transaction: tx,
            cancellationToken: cancellationToken));

        await tx.CommitAsync(cancellationToken);
        return Map(row);
    }

    public async Task<ConnectionScheduleEntry?> SetModeAsync(
        long connectionId, string mode, CancellationToken cancellationToken)
    {
        ValidateMode(mode);

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<Row>(new CommandDefinition(
            """
            UPDATE connection_schedule
            SET mode = @mode
            WHERE connection_id = @connectionId AND effective_to IS NULL
            RETURNING schedule_id AS ScheduleId,
                      connection_id AS ConnectionId,
                      mode AS Mode,
                      window_start::text AS WindowStartText,
                      window_end::text AS WindowEndText,
                      engine AS Engine,
                      tz AS Tz,
                      effective_from AS EffectiveFrom,
                      effective_to AS EffectiveTo,
                      change_source AS ChangeSource,
                      change_note AS ChangeNote;
            """,
            new { connectionId, mode },
            cancellationToken: cancellationToken));
        return row is null ? null : Map(row);
    }

    private static void ValidateMode(string mode)
    {
        if (mode is not (ConnectionScheduleModes.Manual or ConnectionScheduleModes.Scheduled))
        {
            throw new ArgumentException(
                $"mode должен быть '{ConnectionScheduleModes.Manual}' или '{ConnectionScheduleModes.Scheduled}'",
                nameof(mode));
        }
    }

    private static string FormatTime(TimeOnly value) =>
        value.ToString("HH:mm:ss", CultureInfo.InvariantCulture);

    private static ConnectionScheduleEntry Map(Row row) => new()
    {
        ScheduleId = row.ScheduleId,
        ConnectionId = row.ConnectionId,
        Mode = row.Mode,
        WindowStart = ParseTime(row.WindowStartText),
        WindowEnd = ParseTime(row.WindowEndText),
        Engine = row.Engine,
        Tz = row.Tz,
        EffectiveFrom = row.EffectiveFrom,
        EffectiveTo = row.EffectiveTo,
        ChangeSource = row.ChangeSource,
        ChangeNote = row.ChangeNote,
    };

    private static TimeOnly ParseTime(string text) =>
        TimeOnly.Parse(text, CultureInfo.InvariantCulture);

    private sealed class Row
    {
        public long ScheduleId { get; init; }
        public long ConnectionId { get; init; }
        public string Mode { get; init; } = "";
        public string WindowStartText { get; init; } = "";
        public string WindowEndText { get; init; } = "";
        public string Engine { get; init; } = "";
        public string Tz { get; init; } = "";
        public DateTimeOffset EffectiveFrom { get; init; }
        public DateTimeOffset? EffectiveTo { get; init; }
        public string ChangeSource { get; init; } = "";
        public string? ChangeNote { get; init; }
    }
}
