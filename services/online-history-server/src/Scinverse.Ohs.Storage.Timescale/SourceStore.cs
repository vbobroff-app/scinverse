using Dapper;
using Npgsql;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>Справочник источников данных (data_source) в PostgreSQL/TimescaleDB.</summary>
public sealed class SourceStore(NpgsqlDataSource dataSource) : ISourceStore
{
    public async Task<short> ResolveIdAsync(string code, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var sourceId = await connection.QuerySingleOrDefaultAsync<short?>(new CommandDefinition(
            "SELECT source_id FROM data_source WHERE code = @code;",
            new { code },
            cancellationToken: cancellationToken));

        return sourceId
            ?? throw new InvalidOperationException($"Неизвестный источник данных '{code}' (нет в data_source)");
    }

    public async Task<IReadOnlyList<DataSource>> ListAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<DataSource>(new CommandDefinition(
            "SELECT source_id AS SourceId, code AS Code, name AS Name FROM data_source ORDER BY source_id;",
            cancellationToken: cancellationToken));

        return rows.ToList();
    }
}
