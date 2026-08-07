using Dapper;
using Npgsql;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <inheritdoc />
public sealed class RuntimeStateStore(NpgsqlDataSource dataSource) : IRuntimeStateStore
{
    public async Task<string?> GetAsync(string key, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.ExecuteScalarAsync<string?>(new CommandDefinition(
            """
            SELECT value FROM ohs_runtime_state WHERE key = @key;
            """,
            new { key },
            cancellationToken: cancellationToken));
    }

    public async Task SetAsync(string key, string value, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO ohs_runtime_state (key, value, updated_at)
            VALUES (@key, @value, now())
            ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                updated_at = now();
            """,
            new { key, value },
            cancellationToken: cancellationToken));
    }
}
