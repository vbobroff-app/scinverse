using Dapper;
using Npgsql;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>Политики автозаписи (recording_schedule), phase 7i.</summary>
public sealed class RecordingScheduleStore(NpgsqlDataSource dataSource) : IRecordingScheduleStore
{
    private const string SelectColumns =
        "instrument_id AS InstrumentId, connection_id AS ConnectionId, auto_enabled AS AutoEnabled";

    public async Task<IReadOnlyList<RecordingScheduleEntry>> ListAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<RecordingScheduleEntry>(new CommandDefinition(
            $"SELECT {SelectColumns} FROM recording_schedule ORDER BY instrument_id;",
            cancellationToken: cancellationToken));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<RecordingScheduleEntry>> ListEnabledAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<RecordingScheduleEntry>(new CommandDefinition(
            $"SELECT {SelectColumns} FROM recording_schedule WHERE auto_enabled ORDER BY instrument_id;",
            cancellationToken: cancellationToken));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<RecordingScheduleEntry>> UpsertAsync(
        IReadOnlyList<RecordingScheduleEntry> entries, CancellationToken cancellationToken)
    {
        if (entries.Count == 0)
        {
            return [];
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);

        var result = new List<RecordingScheduleEntry>(entries.Count);
        foreach (var entry in entries)
        {
            var row = await connection.QuerySingleAsync<RecordingScheduleEntry>(new CommandDefinition(
                $"""
                INSERT INTO recording_schedule (instrument_id, connection_id, auto_enabled, updated_at)
                VALUES (@InstrumentId, @ConnectionId, @AutoEnabled, now())
                ON CONFLICT (instrument_id) DO UPDATE SET
                    connection_id = EXCLUDED.connection_id,
                    auto_enabled  = EXCLUDED.auto_enabled,
                    updated_at    = now()
                RETURNING {SelectColumns};
                """,
                entry,
                transaction: tx,
                cancellationToken: cancellationToken));
            result.Add(row);
        }

        await tx.CommitAsync(cancellationToken);
        return result;
    }

    public async Task DisableAutoAsync(long instrumentId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE recording_schedule
            SET auto_enabled = false, updated_at = now()
            WHERE instrument_id = @instrumentId AND auto_enabled;
            """,
            new { instrumentId },
            cancellationToken: cancellationToken));
    }

    public async Task DisableAutoManyAsync(IReadOnlyList<long> instrumentIds, CancellationToken cancellationToken)
    {
        if (instrumentIds.Count == 0)
        {
            return;
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE recording_schedule
            SET auto_enabled = false, updated_at = now()
            WHERE instrument_id = ANY(@instrumentIds) AND auto_enabled;
            """,
            new { instrumentIds = instrumentIds.ToArray() },
            cancellationToken: cancellationToken));
    }
}
