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
}
