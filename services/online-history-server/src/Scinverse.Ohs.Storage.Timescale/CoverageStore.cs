using Dapper;
using Npgsql;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>Сегменты покрытия (coverage_segment) в PostgreSQL/TimescaleDB.</summary>
public sealed class CoverageStore(NpgsqlDataSource dataSource) : ICoverageStore
{
    public async Task<long> OpenAsync(
        long instrumentId, short sourceId, DateTimeOffset startedAt, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        // Идемпотентный старт: если активный сегмент уже есть — вернуть его.
        var existing = await connection.QuerySingleOrDefaultAsync<long?>(new CommandDefinition(
            "SELECT segment_id FROM coverage_segment " +
            "WHERE instrument_id = @instrumentId AND source_id = @sourceId AND ended_at IS NULL;",
            new { instrumentId, sourceId },
            cancellationToken: cancellationToken));

        if (existing is { } segmentId)
        {
            return segmentId;
        }

        return await connection.QuerySingleAsync<long>(new CommandDefinition(
            "INSERT INTO coverage_segment (instrument_id, source_id, started_at) " +
            "VALUES (@instrumentId, @sourceId, @startedAt) RETURNING segment_id;",
            new { instrumentId, sourceId, startedAt = startedAt.ToUniversalTime() },
            cancellationToken: cancellationToken));
    }

    public async Task ExtendAsync(long segmentId, long addedCount, CancellationToken cancellationToken)
    {
        if (addedCount <= 0)
        {
            return;
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            "UPDATE coverage_segment SET trade_count = trade_count + @addedCount " +
            "WHERE segment_id = @segmentId AND ended_at IS NULL;",
            new { segmentId, addedCount },
            cancellationToken: cancellationToken));
    }

    public async Task CloseAsync(long segmentId, DateTimeOffset endedAt, string status, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            "UPDATE coverage_segment SET ended_at = @endedAt, status = @status " +
            "WHERE segment_id = @segmentId;",
            new { segmentId, endedAt = endedAt.ToUniversalTime(), status },
            cancellationToken: cancellationToken));
    }

    public async Task<int> RecoverOpenSegmentsAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE coverage_segment s
            SET ended_at = GREATEST(
                    COALESCE(
                        (SELECT max(t.ts) FROM md_trade t
                         WHERE t.instrument_id = s.instrument_id AND t.source_id = s.source_id
                           AND t.ts >= s.started_at),
                        s.started_at),
                    COALESCE(
                        (SELECT max(cl.to_ts) FROM capture_liveness cl
                         WHERE cl.source_id = s.source_id AND cl.open),
                        s.started_at)),
                status = 'interrupted'
            WHERE s.ended_at IS NULL;
            """,
            cancellationToken: cancellationToken));
    }

    public async Task<IReadOnlyList<CoverageSegment>> QuerySegmentsAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<CoverageSegment>(new CommandDefinition(
            "SELECT segment_id AS SegmentId, instrument_id AS InstrumentId, source_id AS SourceId, " +
            "started_at AS StartedAt, ended_at AS EndedAt, trade_count AS TradeCount, status AS Status " +
            "FROM coverage_segment " +
            "WHERE started_at < @to AND (ended_at IS NULL OR ended_at > @from) " +
            "ORDER BY instrument_id, source_id, started_at;",
            new { from = from.ToUniversalTime(), to = to.ToUniversalTime() },
            cancellationToken: cancellationToken));

        return rows.ToList();
    }

    public async Task<IReadOnlyList<CoverageGap>> QueryGapsAsync(
        long instrumentId, short sourceId, DateTimeOffset from, DateTimeOffset to,
        double thresholdSeconds, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<CoverageGap>(new CommandDefinition(
            """
            WITH ordered AS (
                SELECT ts, lead(ts) OVER (ORDER BY ts) AS next_ts
                FROM md_trade
                WHERE instrument_id = @instrumentId AND source_id = @sourceId AND ts BETWEEN @from AND @to
            )
            SELECT ts AS "From", next_ts AS "To"
            FROM ordered
            WHERE next_ts IS NOT NULL AND next_ts - ts > make_interval(secs => @thresholdSeconds)
            ORDER BY ts;
            """,
            new
            {
                instrumentId,
                sourceId,
                from = from.ToUniversalTime(),
                to = to.ToUniversalTime(),
                thresholdSeconds
            },
            cancellationToken: cancellationToken));

        return rows.ToList();
    }

    public async Task<IReadOnlyList<DateOnly>> QueryTradingDaysAsync(
        int count, bool includeWeekends, CancellationToken cancellationToken)
    {
        if (count <= 0)
        {
            return [];
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<DateOnly>(new CommandDefinition(
            """
            SELECT DISTINCT (ts AT TIME ZONE 'Europe/Moscow')::date AS day
            FROM md_trade
            WHERE (@includeWeekends OR extract(isodow FROM (ts AT TIME ZONE 'Europe/Moscow')) < 6)
            ORDER BY day DESC
            LIMIT @count;
            """,
            new { count, includeWeekends },
            cancellationToken: cancellationToken));

        return rows.ToList();
    }

    public async Task<CoverageExtent> QueryCoverageExtentAsync(short? sourceId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleAsync<CoverageExtent>(new CommandDefinition(
            """
            SELECT min(started_at) AS "From",
                   max(coalesce(ended_at, now())) AS "To"
            FROM coverage_segment
            WHERE (@sourceId IS NULL OR source_id = @sourceId);
            """,
            new { sourceId },
            cancellationToken: cancellationToken));
    }
}
