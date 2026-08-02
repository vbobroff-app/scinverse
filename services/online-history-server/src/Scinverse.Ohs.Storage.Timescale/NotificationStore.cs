using Dapper;
using Npgsql;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>
/// Долговременный аудит-лог уведомлений (таблица <c>notification</c>, phase 11.2). Append-only:
/// batch-insert из фонового writer (<c>ON CONFLICT DO NOTHING</c> — идемпотентно по event_id),
/// чтение последних N для бэклога <c>GET /api/notifications</c> и гидратации ring-buffer на старте.
/// </summary>
public sealed class NotificationStore(NpgsqlDataSource dataSource) : INotificationStore
{
    private const string InsertSql =
        """
        INSERT INTO notification (
            event_id, ts, severity, source_type, interaction, localization, status,
            module, code, message, subject, correlation_id,
            actor_kind, actor_id, actor_label, data)
        VALUES (
            @EventId, @Ts, @Severity, @SourceType, @Interaction, @Localization, @Status,
            @Module, @Code, @Message, @Subject, @CorrelationId,
            @ActorKind, @ActorId, @ActorLabel, @Data::jsonb)
        ON CONFLICT (event_id, ts) DO NOTHING;
        """;

    public async Task AppendBatchAsync(
        IReadOnlyCollection<NotificationRecord> records, CancellationToken cancellationToken)
    {
        if (records.Count == 0)
        {
            return;
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        // Dapper выполняет команду для каждой строки списка на одном соединении/транзакции.
        await connection.ExecuteAsync(new CommandDefinition(
            InsertSql, records, transaction: tx, cancellationToken: cancellationToken));
        await tx.CommitAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<NotificationRecord>> QueryRecentAsync(
        int limit, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        // Берём последние N по времени, затем разворачиваем в oldest-first (порядок ленты/буфера).
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            """
            SELECT event_id AS EventId, ts AS Ts, severity AS Severity, source_type AS SourceType,
                   interaction AS Interaction, localization AS Localization, status AS Status,
                   module AS Module, code AS Code, message AS Message, subject AS Subject,
                   correlation_id AS CorrelationId, actor_kind AS ActorKind, actor_id AS ActorId,
                   actor_label AS ActorLabel, data::text AS Data
            FROM notification
            ORDER BY ts DESC
            LIMIT @limit;
            """,
            new { limit }, cancellationToken: cancellationToken));

        var list = rows.Select(ToRecord).ToList();
        list.Reverse();
        return list;
    }

    public async Task<IReadOnlyList<NotificationRecord>> QueryByCorrelationIdAsync(
        string correlationId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(correlationId))
        {
            return [];
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            """
            SELECT event_id AS EventId, ts AS Ts, severity AS Severity, source_type AS SourceType,
                   interaction AS Interaction, localization AS Localization, status AS Status,
                   module AS Module, code AS Code, message AS Message, subject AS Subject,
                   correlation_id AS CorrelationId, actor_kind AS ActorKind, actor_id AS ActorId,
                   actor_label AS ActorLabel, data::text AS Data
            FROM notification
            WHERE correlation_id = @correlationId
            ORDER BY ts ASC, event_id ASC;
            """,
            new { correlationId }, cancellationToken: cancellationToken));
        return rows.Select(ToRecord).ToList();
    }

    public async Task<OpenLinkIncident?> FindOpenLinkIncidentAsync(
        long connectionId, CancellationToken cancellationToken)
    {
        var subject = $"connection:{connectionId}:link";
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        // Latest row per corr; open = active|underway. OpenedAt = MIN(ts) по corr (левая граница дыры).
        var row = await connection.QuerySingleOrDefaultAsync<OpenRow>(new CommandDefinition(
            """
            WITH latest AS (
                SELECT DISTINCT ON (correlation_id)
                    correlation_id AS CorrelationId,
                    status         AS Status,
                    ts             AS LastTs
                FROM notification
                WHERE subject = @subject
                  AND correlation_id IS NOT NULL
                ORDER BY correlation_id, ts DESC, event_id DESC
            )
            SELECT l.CorrelationId,
                   l.Status,
                   (SELECT MIN(n.ts) FROM notification n WHERE n.correlation_id = l.CorrelationId) AS OpenedAt
            FROM latest l
            WHERE l.Status IN ('active', 'underway')
            ORDER BY l.LastTs DESC
            LIMIT 1;
            """,
            new { subject }, cancellationToken: cancellationToken));

        if (row is null || string.IsNullOrWhiteSpace(row.CorrelationId) || string.IsNullOrWhiteSpace(row.Status))
        {
            return null;
        }

        return new OpenLinkIncident(
            row.CorrelationId,
            row.Status,
            new DateTimeOffset(DateTime.SpecifyKind(row.OpenedAt, DateTimeKind.Unspecified), TimeSpan.Zero));
    }

    private sealed record OpenRow(string CorrelationId, string Status, DateTime OpenedAt);

    // timestamptz читаем в DateTime (Kind=Utc от Npgsql) и оборачиваем в UTC-offset — как LinkLivenessStore
    // (прямое чтение timestamptz в DateTimeOffset через Dapper ненадёжно).
    private sealed record Row(
        Guid EventId, DateTime Ts, string Severity, string SourceType, string Interaction,
        string Localization, string? Status, string Module, string Code, string Message,
        string? Subject, string? CorrelationId, string ActorKind, string ActorId, string ActorLabel,
        string? Data);

    private static NotificationRecord ToRecord(Row r) => new()
    {
        EventId = r.EventId,
        Ts = new DateTimeOffset(DateTime.SpecifyKind(r.Ts, DateTimeKind.Unspecified), TimeSpan.Zero),
        Severity = r.Severity,
        SourceType = r.SourceType,
        Interaction = r.Interaction,
        Localization = r.Localization,
        Status = r.Status,
        Module = r.Module,
        Code = r.Code,
        Message = r.Message,
        Subject = r.Subject,
        CorrelationId = r.CorrelationId,
        ActorKind = r.ActorKind,
        ActorId = r.ActorId,
        ActorLabel = r.ActorLabel,
        Data = r.Data,
    };
}
