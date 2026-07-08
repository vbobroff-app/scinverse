using Dapper;
using Npgsql;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>Подключения коннекторов (connector_connection). Без секретов.</summary>
public sealed class ConnectionStore(NpgsqlDataSource dataSource) : IConnectionStore
{
    private const string SelectColumns =
        "connection_id AS ConnectionId, source_id AS SourceId, name AS Name, kind AS Kind, " +
        "settings AS Settings, enabled AS Enabled";

    public async Task<IReadOnlyList<ConnectorConnection>> ListAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<ConnectorConnection>(new CommandDefinition(
            $"SELECT {SelectColumns} FROM connector_connection ORDER BY connection_id;",
            cancellationToken: cancellationToken));

        return rows.ToList();
    }

    public async Task<ConnectorConnection?> GetAsync(long connectionId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<ConnectorConnection>(new CommandDefinition(
            $"SELECT {SelectColumns} FROM connector_connection WHERE connection_id = @connectionId;",
            new { connectionId },
            cancellationToken: cancellationToken));
    }

    public async Task<ConnectorConnection> UpsertAsync(
        short sourceId, string name, string kind, string settings, bool enabled, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleAsync<ConnectorConnection>(new CommandDefinition(
            $"""
            INSERT INTO connector_connection (source_id, name, kind, settings, enabled)
            VALUES (@sourceId, @name, @kind, @settings::jsonb, @enabled)
            ON CONFLICT (name) DO UPDATE SET
                source_id  = EXCLUDED.source_id,
                kind       = EXCLUDED.kind,
                settings   = EXCLUDED.settings,
                enabled    = EXCLUDED.enabled,
                updated_at = now()
            RETURNING {SelectColumns};
            """,
            new { sourceId, name, kind, settings, enabled },
            cancellationToken: cancellationToken));
    }

    public async Task SetEnabledAsync(long connectionId, bool enabled, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            "UPDATE connector_connection SET enabled = @enabled, updated_at = now() " +
            "WHERE connection_id = @connectionId;",
            new { connectionId, enabled },
            cancellationToken: cancellationToken));
    }
}
