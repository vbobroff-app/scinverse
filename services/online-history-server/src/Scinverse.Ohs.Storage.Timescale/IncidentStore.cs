using Dapper;
using Npgsql;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>Журнал инцидентов (таблица <c>incident</c>, phase 11.13a).</summary>
public sealed class IncidentStore(NpgsqlDataSource dataSource) : IIncidentStore
{
    private const string SelectColumns =
        """
        corr_uid AS CorrUid, module AS Module, type AS Type, status AS Status,
        close_outcome AS CloseOutcome, opened_at AS OpenedAt, closed_at AS ClosedAt,
        subject AS Subject, severity AS Severity, title AS Title,
        last_activity_at AS LastActivityAt, connection_id AS ConnectionId,
        source_id AS SourceId, escalated_at AS EscalatedAt, subtype AS Subtype,
        owner AS Owner, payload::text AS Payload,
        deleted_at AS DeletedAt, deleted_by AS DeletedBy
        """;

    public async Task<bool> OpenAsync(Incident incident, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO incident (
                corr_uid, module, type, status, close_outcome,
                opened_at, closed_at, subject, severity, title, last_activity_at,
                connection_id, source_id, escalated_at, subtype, owner, payload)
            VALUES (
                @CorrUid, @Module, @Type, @Status, @CloseOutcome,
                @OpenedAt, @ClosedAt, @Subject, @Severity, @Title, @LastActivityAt,
                @ConnectionId, @SourceId, @EscalatedAt, @Subtype, @Owner, @Payload::jsonb)
            ON CONFLICT (corr_uid) DO NOTHING;
            """,
            ToRow(incident),
            cancellationToken: cancellationToken));
        return rows > 0;
    }

    public async Task<bool> UpdateOpenAsync(Incident incident, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE incident SET
                module = @Module,
                type = @Type,
                status = @Status,
                subject = @Subject,
                severity = @Severity,
                title = @Title,
                last_activity_at = @LastActivityAt,
                connection_id = @ConnectionId,
                source_id = @SourceId,
                escalated_at = @EscalatedAt,
                subtype = @Subtype,
                owner = @Owner,
                payload = @Payload::jsonb
            WHERE corr_uid = @CorrUid
              AND status IN ('active', 'recovering')
              AND deleted_at IS NULL;
            """,
            ToRow(incident),
            cancellationToken: cancellationToken));
        return rows > 0;
    }

    public async Task<bool> ResolveAsync(
        string corrUid,
        DateTimeOffset closedAt,
        string closeOutcome,
        string? title,
        string? severity,
        string? resolvedBy,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE incident SET
                status = 'resolved',
                close_outcome = @closeOutcome,
                closed_at = @closedAt,
                last_activity_at = @closedAt,
                title = COALESCE(@title, title),
                severity = COALESCE(@severity, severity),
                payload = CASE
                    WHEN @resolvedBy IS NULL OR btrim(@resolvedBy) = '' THEN payload
                    ELSE COALESCE(payload, '{}'::jsonb)
                         || jsonb_build_object('resolvedBy', @resolvedBy)
                END
            WHERE corr_uid = @corrUid
              AND status IN ('active', 'recovering')
              AND deleted_at IS NULL;
            """,
            new
            {
                corrUid,
                closedAt = closedAt.ToUniversalTime(),
                closeOutcome,
                title,
                severity,
                resolvedBy,
            },
            cancellationToken: cancellationToken));
        return rows > 0;
    }

    public async Task<bool> AnnotateResolvedByAsync(
        string corrUid, string resolvedBy, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(resolvedBy))
        {
            return false;
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE incident SET
                payload = COALESCE(payload, '{}'::jsonb)
                          || jsonb_build_object('resolvedBy', @resolvedBy)
            WHERE corr_uid = @corrUid;
            """,
            new { corrUid, resolvedBy },
            cancellationToken: cancellationToken));
        return rows > 0;
    }

    public async Task<bool> AnnotateCloseNoteAsync(
        string corrUid, string closeNote, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(closeNote))
        {
            return false;
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE incident SET
                payload = COALESCE(payload, '{}'::jsonb)
                          || jsonb_build_object('closeNote', @closeNote)
            WHERE corr_uid = @corrUid;
            """,
            new { corrUid, closeNote = closeNote.Trim() },
            cancellationToken: cancellationToken));
        return rows > 0;
    }

    public async Task<bool> BindConnectionIdIfNullAsync(
        string corrUid, long connectionId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE incident
            SET connection_id = @connectionId
            WHERE corr_uid = @corrUid
              AND connection_id IS NULL;
            """,
            new { corrUid, connectionId },
            cancellationToken: cancellationToken));
        return rows > 0;
    }

    public async Task<Incident?> GetAsync(string corrUid, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<Row>(new CommandDefinition(
            $"""
            SELECT {SelectColumns}
            FROM incident
            WHERE corr_uid = @corrUid;
            """,
            new { corrUid },
            cancellationToken: cancellationToken));
        return row is null ? null : ToIncident(row);
    }

    public async Task<Incident?> FindOpenBreakAsync(long connectionId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<Row>(new CommandDefinition(
            $"""
            SELECT {SelectColumns}
            FROM incident
            WHERE module = 'connection'
              AND type = 'break'
              AND connection_id = @connectionId
              AND status IN ('active', 'recovering')
              AND deleted_at IS NULL
            ORDER BY opened_at DESC
            LIMIT 1;
            """,
            new { connectionId },
            cancellationToken: cancellationToken));
        return row is null ? null : ToIncident(row);
    }

    public async Task<IReadOnlyList<Incident>> QueryAsync(
        IncidentQuery query, CancellationToken cancellationToken)
    {
        var limit = query.Limit > 0 ? Math.Min(query.Limit, 1000) : 100;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        // Пересечение с окном [from, to): opened_at < to AND (open OR closed_at > from).
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            $"""
            SELECT {SelectColumns}
            FROM incident
            WHERE (@module IS NULL OR module = @module)
              AND (@status IS NULL OR status = @status)
              AND (@type IS NULL OR type = @type)
              AND (
                  @connectionId IS NULL
                  OR connection_id = @connectionId
                  OR EXISTS (
                      SELECT 1
                      FROM incident_connection ic
                      WHERE ic.corr_uid = incident.corr_uid
                        AND ic.connection_id = @connectionId
                  )
              )
              AND (@from IS NULL OR closed_at IS NULL OR closed_at > @from)
              AND (@to IS NULL OR opened_at < @to)
              AND (@includeDeleted OR deleted_at IS NULL)
            ORDER BY opened_at DESC
            LIMIT @limit;
            """,
            new
            {
                module = query.Module,
                status = query.Status,
                type = query.Type,
                connectionId = query.ConnectionId,
                from = query.From?.ToUniversalTime(),
                to = query.To?.ToUniversalTime(),
                includeDeleted = query.IncludeDeleted,
                limit,
            },
            cancellationToken: cancellationToken));
        return rows.Select(ToIncident).ToList();
    }

    public async Task<bool> SoftDeleteAsync(
        string corrUid, DateTimeOffset deletedAt, string? deletedBy, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE incident SET
                deleted_at = @deletedAt,
                deleted_by = @deletedBy
            WHERE corr_uid = @corrUid;
            """,
            new
            {
                corrUid,
                deletedAt = deletedAt.ToUniversalTime(),
                deletedBy = string.IsNullOrWhiteSpace(deletedBy) ? null : deletedBy.Trim(),
            },
            cancellationToken: cancellationToken));
        return rows > 0;
    }

    public async Task<bool> RestoreAsync(string corrUid, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE incident SET
                deleted_at = NULL,
                deleted_by = NULL
            WHERE corr_uid = @corrUid
              AND deleted_at IS NOT NULL;
            """,
            new { corrUid },
            cancellationToken: cancellationToken));
        return rows > 0;
    }

    public async Task ReplaceConnectionScopeAsync(
        string corrUid, IReadOnlyList<long> connectionIds, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM incident_connection WHERE corr_uid = @corrUid;",
            new { corrUid },
            transaction: tx,
            cancellationToken: cancellationToken));

        if (connectionIds.Count > 0)
        {
            var rows = connectionIds
                .Distinct()
                .Select(id => new { corrUid, connectionId = id })
                .ToArray();
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO incident_connection (corr_uid, connection_id)
                VALUES (@corrUid, @connectionId)
                ON CONFLICT DO NOTHING;
                """,
                rows,
                transaction: tx,
                cancellationToken: cancellationToken));
        }

        await tx.CommitAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<long>> ListConnectionScopeAsync(
        string corrUid, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var ids = await connection.QueryAsync<long>(new CommandDefinition(
            """
            SELECT connection_id
            FROM incident_connection
            WHERE corr_uid = @corrUid
            ORDER BY connection_id;
            """,
            new { corrUid },
            cancellationToken: cancellationToken));
        return ids.ToList();
    }

    private sealed record Row(
        string CorrUid,
        string Module,
        string Type,
        string Status,
        string? CloseOutcome,
        DateTime OpenedAt,
        DateTime? ClosedAt,
        string Subject,
        string Severity,
        string Title,
        DateTime LastActivityAt,
        long? ConnectionId,
        short? SourceId,
        DateTime? EscalatedAt,
        string? Subtype,
        string? Owner,
        string? Payload,
        DateTime? DeletedAt,
        string? DeletedBy);

    private static object ToRow(Incident i) => new
    {
        i.CorrUid,
        i.Module,
        i.Type,
        i.Status,
        i.CloseOutcome,
        OpenedAt = i.OpenedAt.ToUniversalTime(),
        ClosedAt = i.ClosedAt?.ToUniversalTime(),
        i.Subject,
        i.Severity,
        Title = i.Title ?? "",
        LastActivityAt = i.LastActivityAt.ToUniversalTime(),
        i.ConnectionId,
        i.SourceId,
        EscalatedAt = i.EscalatedAt?.ToUniversalTime(),
        i.Subtype,
        i.Owner,
        Payload = i.Payload,
    };

    private static Incident ToIncident(Row r) => new()
    {
        CorrUid = r.CorrUid,
        Module = r.Module,
        Type = r.Type,
        Status = r.Status,
        CloseOutcome = r.CloseOutcome,
        OpenedAt = ToUtc(r.OpenedAt),
        ClosedAt = r.ClosedAt is { } c ? ToUtc(c) : null,
        Subject = r.Subject,
        Severity = r.Severity,
        Title = r.Title,
        LastActivityAt = ToUtc(r.LastActivityAt),
        ConnectionId = r.ConnectionId,
        SourceId = r.SourceId,
        EscalatedAt = r.EscalatedAt is { } e ? ToUtc(e) : null,
        Subtype = r.Subtype,
        Owner = r.Owner,
        Payload = r.Payload,
        DeletedAt = r.DeletedAt is { } d ? ToUtc(d) : null,
        DeletedBy = r.DeletedBy,
    };

    private static DateTimeOffset ToUtc(DateTime ts) =>
        new(DateTime.SpecifyKind(ts, DateTimeKind.Unspecified), TimeSpan.Zero);
}
