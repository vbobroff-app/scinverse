using Dapper;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>
/// Живость захвата (honest background) в компактной интервальной форме (capture_liveness).
/// Хартбит продлевает открытый интервал; большой разрыв тиков/обрыв закрывает его; следующий хартбит
/// открывает новый. Зазор между интервалами = реальная дыра захвата.
/// </summary>
public sealed class CaptureLivenessStore(Npgsql.NpgsqlDataSource dataSource) : ICaptureLivenessStore
{
    // Позиционный record → to_ts маппим как DateTime (Npgsql отдаёт timestamptz как DateTime Utc).
    private sealed record OpenRow(long LivenessId, DateTime ToTs);

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
                "UPDATE capture_liveness SET open = false WHERE liveness_id = @id;",
                new { id = open.LivenessId }, transaction: tx, cancellationToken: cancellationToken));
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

    public async Task CloseAsync(short sourceId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            "UPDATE capture_liveness SET open = false WHERE source_id = @sourceId AND open;",
            new { sourceId }, cancellationToken: cancellationToken));
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
        var rows = await connection.QueryAsync<LivenessInterval>(new CommandDefinition(
            """
            SELECT source_id AS SourceId, from_ts AS "From", to_ts AS "To", open AS Open
            FROM capture_liveness
            WHERE source_id = ANY(@ids) AND from_ts < @to AND (open OR to_ts > @from)
            ORDER BY source_id, from_ts;
            """,
            new { ids, from = from.ToUniversalTime(), to = to.ToUniversalTime() },
            cancellationToken: cancellationToken));

        return rows.ToList();
    }

    public async Task<int> RecoverOpenIntervalsAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.ExecuteAsync(new CommandDefinition(
            "UPDATE capture_liveness SET open = false WHERE open;",
            cancellationToken: cancellationToken));
    }
}
