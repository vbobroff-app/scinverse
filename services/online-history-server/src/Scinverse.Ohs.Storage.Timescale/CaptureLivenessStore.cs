using Dapper;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>
/// Живость захвата (honest background) в компактной интервальной форме (capture_liveness).
/// Хартбит продлевает открытый интервал; большой разрыв тиков/обрыв закрывает его с причиной; следующий
/// хартбит открывает новый. Зазор между интервалами = реальная дыра захвата (журнал разрывов).
/// </summary>
public sealed class CaptureLivenessStore(Npgsql.NpgsqlDataSource dataSource) : ICaptureLivenessStore
{
    // Позиционный record → to_ts маппим как DateTime (Npgsql отдаёт timestamptz как DateTime Utc).
    private sealed record OpenRow(long LivenessId, DateTime ToTs);

    private sealed record IntervalRow(short SourceId, DateTime From, DateTime To, bool Open, string? CloseReason);

    private sealed record GapRow(short SourceId, DateTime From, DateTime? To, string Cause);

    public async Task HeartbeatAsync(short sourceId, DateTimeOffset ts, TimeSpan maxGap, CancellationToken cancellationToken)
    {
        var tsUtc = ts.ToUniversalTime();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);

        var open = await connection.QuerySingleOrDefaultAsync<OpenRow?>(new CommandDefinition(
            "SELECT liveness_id AS LivenessId, to_ts AS ToTs FROM capture_liveness " +
            "WHERE source_id = @sourceId AND open FOR UPDATE;",
            new { sourceId }, transaction: tx, cancellationToken: cancellationToken));

        if (open is null)
        {
            await InsertOpenAsync(connection, tx, sourceId, tsUtc, cancellationToken);
        }
        else if (tsUtc.UtcDateTime - open.ToTs <= maxGap)
        {
            // Продлеваем открытый интервал (монотонно — на случай перескока часов).
            await connection.ExecuteAsync(new CommandDefinition(
                "UPDATE capture_liveness SET to_ts = GREATEST(to_ts, @ts) WHERE liveness_id = @id;",
                new { id = open.LivenessId, ts = tsUtc }, transaction: tx, cancellationToken: cancellationToken));
        }
        else
        {
            // Пропущены тики (> maxGap) = неявный обрыв: закрываем старый (to_ts замирает), открываем новый.
            await connection.ExecuteAsync(new CommandDefinition(
                "UPDATE capture_liveness SET open = false, close_reason = @reason WHERE liveness_id = @id;",
                new { id = open.LivenessId, reason = ToDb(CaptureCloseReason.Interrupted) },
                transaction: tx, cancellationToken: cancellationToken));
            await InsertOpenAsync(connection, tx, sourceId, tsUtc, cancellationToken);
        }

        await tx.CommitAsync(cancellationToken);
    }

    private static Task<int> InsertOpenAsync(
        Npgsql.NpgsqlConnection connection, System.Data.Common.DbTransaction tx,
        short sourceId, DateTimeOffset tsUtc, CancellationToken cancellationToken) =>
        connection.ExecuteAsync(new CommandDefinition(
            "INSERT INTO capture_liveness (source_id, from_ts, to_ts, open) VALUES (@sourceId, @ts, @ts, true);",
            new { sourceId, ts = tsUtc }, transaction: tx, cancellationToken: cancellationToken));

    public async Task CloseAsync(
        short sourceId, CaptureCloseReason reason, DateTimeOffset? atTs, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        // atTs (точное время события, напр. server_down) сдвигает to_ts вперёд (не назад — иначе разрыв < 0).
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE capture_liveness
            SET open = false,
                close_reason = @reason,
                to_ts = CASE WHEN @atTs IS NULL THEN to_ts ELSE GREATEST(to_ts, @atTs) END
            WHERE source_id = @sourceId AND open;
            """,
            new { sourceId, reason = ToDb(reason), atTs = atTs?.ToUniversalTime() },
            cancellationToken: cancellationToken));
    }

    public async Task<IReadOnlyList<LivenessInterval>> QueryAsync(
        IReadOnlyCollection<short> sourceIds, DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken)
    {
        if (sourceIds.Count == 0)
        {
            return [];
        }

        var ids = sourceIds.Distinct().ToArray();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<IntervalRow>(new CommandDefinition(
            """
            SELECT source_id AS SourceId, from_ts AS "From", to_ts AS "To", open AS Open, close_reason AS CloseReason
            FROM capture_liveness
            WHERE source_id = ANY(@ids) AND from_ts < @to AND (open OR to_ts > @from)
            ORDER BY source_id, from_ts;
            """,
            new { ids, from = from.ToUniversalTime(), to = to.ToUniversalTime() },
            cancellationToken: cancellationToken));

        return rows.Select(r => new LivenessInterval
        {
            SourceId = r.SourceId,
            From = ToUtcOffset(r.From),
            To = ToUtcOffset(r.To),
            Open = r.Open,
            CloseReason = r.CloseReason is null ? null : FromDb(r.CloseReason),
        }).ToList();
    }

    public async Task<IReadOnlyList<CaptureGap>> QueryGapsAsync(
        IReadOnlyCollection<short> sourceIds, DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken)
    {
        if (sourceIds.Count == 0)
        {
            return [];
        }

        var ids = sourceIds.Distinct().ToArray();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        // Разрыв = [to_ts закрытого «обрывного» интервала, from_ts следующего). 'stopped' — не разрыв.
        var rows = await connection.QueryAsync<GapRow>(new CommandDefinition(
            """
            SELECT source_id AS SourceId, gap_from AS "From", gap_to AS "To", cause AS Cause
            FROM (
                SELECT source_id,
                       to_ts AS gap_from,
                       lead(from_ts) OVER (PARTITION BY source_id ORDER BY from_ts) AS gap_to,
                       close_reason AS cause
                FROM capture_liveness
                WHERE source_id = ANY(@ids)
            ) g
            WHERE cause IN ('server_down', 'ping_failed', 'interrupted')
              AND gap_from < @to
              AND (gap_to IS NULL OR gap_to > @from)
            ORDER BY source_id, gap_from;
            """,
            new { ids, from = from.ToUniversalTime(), to = to.ToUniversalTime() },
            cancellationToken: cancellationToken));

        return rows.Select(r => new CaptureGap
        {
            SourceId = r.SourceId,
            From = ToUtcOffset(r.From),
            To = r.To is { } dt ? ToUtcOffset(dt) : null,
            Cause = FromDb(r.Cause),
        }).ToList();
    }

    public async Task<int> RecoverOpenIntervalsAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.ExecuteAsync(new CommandDefinition(
            "UPDATE capture_liveness SET open = false, close_reason = @reason WHERE open;",
            new { reason = ToDb(CaptureCloseReason.Interrupted) },
            cancellationToken: cancellationToken));
    }

    private static DateTimeOffset ToUtcOffset(DateTime ts) =>
        new(DateTime.SpecifyKind(ts, DateTimeKind.Unspecified), TimeSpan.Zero);

    private static string ToDb(CaptureCloseReason reason) => reason switch
    {
        CaptureCloseReason.Stopped => "stopped",
        CaptureCloseReason.ServerDown => "server_down",
        CaptureCloseReason.PingFailed => "ping_failed",
        CaptureCloseReason.Interrupted => "interrupted",
        _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
    };

    private static CaptureCloseReason FromDb(string reason) => reason switch
    {
        "stopped" => CaptureCloseReason.Stopped,
        "server_down" => CaptureCloseReason.ServerDown,
        "ping_failed" => CaptureCloseReason.PingFailed,
        "interrupted" => CaptureCloseReason.Interrupted,
        _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
    };
}
