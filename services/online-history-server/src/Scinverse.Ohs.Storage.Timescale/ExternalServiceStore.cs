using Dapper;
using Npgsql;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>
/// Внешние сервисы-интеграции (external_service) в PostgreSQL. Секрет персистится, но в read-модель
/// не попадает: наружу отдаём только <c>HasSecret</c>, значение — через <see cref="GetSecretAsync"/>.
/// При upsert/update <c>secret = null</c> означает «не менять» (COALESCE с существующим).
/// </summary>
public sealed class ExternalServiceStore(NpgsqlDataSource dataSource) : IExternalServiceStore
{
    private const string SelectColumns =
        "service_id AS ServiceId, name AS Name, adapter AS Adapter, transport AS Transport, " +
        "(secret IS NOT NULL AND length(secret) > 0) AS HasSecret, " +
        "secret_expires_on AS SecretExpiresOn, enabled AS Enabled, use_for_schedule AS UseForSchedule";

    public async Task<IReadOnlyList<ExternalService>> ListAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<ExternalService>(new CommandDefinition(
            $"SELECT {SelectColumns} FROM external_service ORDER BY service_id;",
            cancellationToken: cancellationToken));
        return rows.ToList();
    }

    public async Task<ExternalService?> GetAsync(long serviceId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<ExternalService>(new CommandDefinition(
            $"SELECT {SelectColumns} FROM external_service WHERE service_id = @serviceId;",
            new { serviceId },
            cancellationToken: cancellationToken));
    }

    public async Task<ExternalService> UpsertAsync(
        string name, string adapter, string transport, string? secret, DateOnly? secretExpiresOn,
        bool enabled, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleAsync<ExternalService>(new CommandDefinition(
            $"""
            INSERT INTO external_service (name, adapter, transport, secret, secret_expires_on, enabled)
            VALUES (@name, @adapter, @transport, @secret, @secretExpiresOn, @enabled)
            ON CONFLICT (name) DO UPDATE SET
                adapter           = EXCLUDED.adapter,
                transport         = EXCLUDED.transport,
                secret            = COALESCE(EXCLUDED.secret, external_service.secret),
                secret_expires_on = EXCLUDED.secret_expires_on,
                enabled           = EXCLUDED.enabled,
                updated_at        = now()
            RETURNING {SelectColumns};
            """,
            new { name, adapter, transport, secret, secretExpiresOn, enabled },
            cancellationToken: cancellationToken));
    }

    public async Task<ExternalService?> UpdateAsync(
        long serviceId, string name, string adapter, string transport, string? secret, DateOnly? secretExpiresOn,
        bool enabled, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<ExternalService>(new CommandDefinition(
            $"""
            UPDATE external_service SET
                name              = @name,
                adapter           = @adapter,
                transport         = @transport,
                secret            = COALESCE(@secret, secret),
                secret_expires_on = @secretExpiresOn,
                enabled           = @enabled,
                updated_at        = now()
            WHERE service_id = @serviceId
            RETURNING {SelectColumns};
            """,
            new { serviceId, name, adapter, transport, secret, secretExpiresOn, enabled },
            cancellationToken: cancellationToken));
    }

    public async Task<bool> DeleteAsync(long serviceId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var affected = await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM external_service WHERE service_id = @serviceId;",
            new { serviceId },
            cancellationToken: cancellationToken));
        return affected > 0;
    }

    public async Task<string?> GetSecretAsync(long serviceId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<string?>(new CommandDefinition(
            "SELECT secret FROM external_service WHERE service_id = @serviceId;",
            new { serviceId },
            cancellationToken: cancellationToken));
    }

    public async Task<ExternalService?> GetScheduleSourceAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<ExternalService>(new CommandDefinition(
            $"SELECT {SelectColumns} FROM external_service WHERE use_for_schedule LIMIT 1;",
            cancellationToken: cancellationToken));
    }

    public async Task<ExternalService?> SetScheduleSourceAsync(
        long serviceId, bool enabled, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        // Эксклюзивность: сначала снимаем признак со всех (двумя шагами, чтобы partial unique index не
        // ловил транзиентный конфликт при «перевешивании»), затем ставим целевому.
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        if (enabled)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                "UPDATE external_service SET use_for_schedule = FALSE, updated_at = now() WHERE use_for_schedule;",
                transaction: tx, cancellationToken: cancellationToken));
        }

        await connection.ExecuteAsync(new CommandDefinition(
            "UPDATE external_service SET use_for_schedule = @enabled, updated_at = now() WHERE service_id = @serviceId;",
            new { serviceId, enabled }, transaction: tx, cancellationToken: cancellationToken));

        var updated = await connection.QuerySingleOrDefaultAsync<ExternalService>(new CommandDefinition(
            $"SELECT {SelectColumns} FROM external_service WHERE service_id = @serviceId;",
            new { serviceId }, transaction: tx, cancellationToken: cancellationToken));

        await tx.CommitAsync(cancellationToken);
        return updated;
    }
}
