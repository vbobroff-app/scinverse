using Dapper;
using Npgsql;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>Наборы Observed (catalog-basket-instruments C0).</summary>
public sealed class BasketStore(NpgsqlDataSource dataSource) : IBasketStore
{
    public const string SystemRecording = "recording";
    public const string SystemHasData = "has_data";

    public async Task EnsureSystemBasketsAsync(long connectionId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO instrument_basket (connection_id, kind, name, system_id, enabled)
            SELECT @connectionId, 'system', 'Recording', @recording, TRUE
            WHERE NOT EXISTS (
                SELECT 1 FROM instrument_basket
                WHERE connection_id = @connectionId AND system_id = @recording);

            INSERT INTO instrument_basket (connection_id, kind, name, system_id, enabled)
            SELECT @connectionId, 'system', 'HasData', @hasData, FALSE
            WHERE NOT EXISTS (
                SELECT 1 FROM instrument_basket
                WHERE connection_id = @connectionId AND system_id = @hasData);
            """,
            new
            {
                connectionId,
                recording = SystemRecording,
                hasData = SystemHasData,
            },
            cancellationToken: cancellationToken));
    }

    public async Task<IReadOnlyList<InstrumentBasket>> ListAsync(
        long connectionId, CancellationToken cancellationToken)
    {
        await EnsureSystemBasketsAsync(connectionId, cancellationToken);

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<BasketRow>(new CommandDefinition(
            """
            SELECT b.basket_id AS BasketId, b.connection_id AS ConnectionId, b.kind AS Kind,
                   b.name AS Name, b.system_id AS SystemId, b.enabled AS Enabled,
                   b.created_at AS CreatedAt, b.updated_at AS UpdatedAt,
                   r.patterns AS Patterns, r.sec_type AS SecType, r.board_id AS BoardId
            FROM instrument_basket b
            LEFT JOIN basket_rule r ON r.basket_id = b.basket_id
            WHERE b.connection_id = @connectionId
            ORDER BY
                CASE b.kind WHEN 'system' THEN 1 WHEN 'static' THEN 2 ELSE 3 END,
                b.system_id NULLS LAST,
                b.name,
                b.basket_id;
            """,
            new { connectionId },
            cancellationToken: cancellationToken));

        return rows.Select(Map).ToList();
    }

    public async Task<InstrumentBasket?> GetAsync(long basketId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<BasketRow>(new CommandDefinition(
            """
            SELECT b.basket_id AS BasketId, b.connection_id AS ConnectionId, b.kind AS Kind,
                   b.name AS Name, b.system_id AS SystemId, b.enabled AS Enabled,
                   b.created_at AS CreatedAt, b.updated_at AS UpdatedAt,
                   r.patterns AS Patterns, r.sec_type AS SecType, r.board_id AS BoardId
            FROM instrument_basket b
            LEFT JOIN basket_rule r ON r.basket_id = b.basket_id
            WHERE b.basket_id = @basketId;
            """,
            new { basketId },
            cancellationToken: cancellationToken));

        return row is null ? null : Map(row);
    }

    public async Task<InstrumentBasket> CreateStaticAsync(
        long connectionId,
        string name,
        BasketRule rule,
        bool enabled,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentNullException.ThrowIfNull(rule);

        await EnsureSystemBasketsAsync(connectionId, cancellationToken);

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);

        var basketId = await connection.ExecuteScalarAsync<long>(new CommandDefinition(
            """
            INSERT INTO instrument_basket (connection_id, kind, name, system_id, enabled)
            VALUES (@connectionId, 'static', @name, NULL, @enabled)
            RETURNING basket_id;
            """,
            new { connectionId, name = name.Trim(), enabled },
            transaction: tx,
            cancellationToken: cancellationToken));

        await InsertRuleAsync(connection, tx, basketId, rule, cancellationToken);
        await tx.CommitAsync(cancellationToken);

        var created = await GetAsync(basketId, cancellationToken);
        return created ?? throw new InvalidOperationException($"Basket {basketId} not found after create.");
    }

    public async Task<InstrumentBasket> UpdateStaticAsync(
        long basketId,
        string name,
        BasketRule rule,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentNullException.ThrowIfNull(rule);

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);

        var kind = await connection.ExecuteScalarAsync<string?>(new CommandDefinition(
            "SELECT kind FROM instrument_basket WHERE basket_id = @basketId;",
            new { basketId },
            transaction: tx,
            cancellationToken: cancellationToken));

        if (kind is null)
        {
            throw new InvalidOperationException($"Basket {basketId} not found.");
        }

        if (!string.Equals(kind, "static", StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"Basket {basketId} is '{kind}', expected static.");
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE instrument_basket
            SET name = @name, updated_at = now()
            WHERE basket_id = @basketId;
            """,
            new { basketId, name = name.Trim() },
            transaction: tx,
            cancellationToken: cancellationToken));

        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO basket_rule (basket_id, patterns, sec_type, board_id)
            VALUES (@basketId, @patterns, @secType, @boardId)
            ON CONFLICT (basket_id) DO UPDATE SET
                patterns = EXCLUDED.patterns,
                sec_type = EXCLUDED.sec_type,
                board_id = EXCLUDED.board_id;
            """,
            new
            {
                basketId,
                patterns = rule.Patterns.ToArray(),
                secType = rule.SecType,
                boardId = rule.BoardId,
            },
            transaction: tx,
            cancellationToken: cancellationToken));

        await tx.CommitAsync(cancellationToken);

        var updated = await GetAsync(basketId, cancellationToken);
        return updated ?? throw new InvalidOperationException($"Basket {basketId} not found after update.");
    }

    public async Task<InstrumentBasket> SetEnabledAsync(
        long basketId, bool enabled, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var affected = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE instrument_basket
            SET enabled = @enabled, updated_at = now()
            WHERE basket_id = @basketId;
            """,
            new { basketId, enabled },
            cancellationToken: cancellationToken));

        if (affected == 0)
        {
            throw new InvalidOperationException($"Basket {basketId} not found.");
        }

        var row = await GetAsync(basketId, cancellationToken);
        return row ?? throw new InvalidOperationException($"Basket {basketId} not found after enable.");
    }

    public async Task DeleteAsync(long basketId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var kind = await connection.ExecuteScalarAsync<string?>(new CommandDefinition(
            "SELECT kind FROM instrument_basket WHERE basket_id = @basketId;",
            new { basketId },
            cancellationToken: cancellationToken));

        if (kind is null)
        {
            throw new InvalidOperationException($"Basket {basketId} not found.");
        }

        if (string.Equals(kind, "system", StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"System basket {basketId} cannot be deleted.");
        }

        await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM instrument_basket WHERE basket_id = @basketId;",
            new { basketId },
            cancellationToken: cancellationToken));
    }

    public async Task ReplaceMembersAsync(
        long basketId,
        IReadOnlyList<long> instrumentIds,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(instrumentIds);

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);

        var exists = await connection.ExecuteScalarAsync<bool>(new CommandDefinition(
            "SELECT EXISTS(SELECT 1 FROM instrument_basket WHERE basket_id = @basketId);",
            new { basketId },
            transaction: tx,
            cancellationToken: cancellationToken));

        if (!exists)
        {
            throw new InvalidOperationException($"Basket {basketId} not found.");
        }

        await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM basket_member WHERE basket_id = @basketId;",
            new { basketId },
            transaction: tx,
            cancellationToken: cancellationToken));

        if (instrumentIds.Count > 0)
        {
            // DISTINCT — один instrument в одном basket один раз.
            var ids = instrumentIds.Distinct().ToArray();
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO basket_member (basket_id, instrument_id)
                SELECT @basketId, x
                FROM unnest(@ids::bigint[]) AS x;
                """,
                new { basketId, ids },
                transaction: tx,
                cancellationToken: cancellationToken));
        }

        await connection.ExecuteAsync(new CommandDefinition(
            "UPDATE instrument_basket SET updated_at = now() WHERE basket_id = @basketId;",
            new { basketId },
            transaction: tx,
            cancellationToken: cancellationToken));

        await tx.CommitAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<long>> ListMemberIdsAsync(
        long basketId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<long>(new CommandDefinition(
            """
            SELECT instrument_id
            FROM basket_member
            WHERE basket_id = @basketId
            ORDER BY instrument_id;
            """,
            new { basketId },
            cancellationToken: cancellationToken));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<long>> ListEnabledStaticMemberIdsAsync(
        long connectionId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<long>(new CommandDefinition(
            """
            SELECT DISTINCT m.instrument_id
            FROM basket_member m
            INNER JOIN instrument_basket b ON b.basket_id = m.basket_id
            WHERE b.connection_id = @connectionId
              AND b.enabled
              AND b.kind = 'static'
            ORDER BY m.instrument_id;
            """,
            new { connectionId },
            cancellationToken: cancellationToken));
        return rows.ToList();
    }

    private static async Task InsertRuleAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction tx,
        long basketId,
        BasketRule rule,
        CancellationToken cancellationToken)
    {
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO basket_rule (basket_id, patterns, sec_type, board_id)
            VALUES (@basketId, @patterns, @secType, @boardId);
            """,
            new
            {
                basketId,
                patterns = rule.Patterns.ToArray(),
                secType = rule.SecType,
                boardId = rule.BoardId,
            },
            transaction: tx,
            cancellationToken: cancellationToken));
    }

    private static InstrumentBasket Map(BasketRow row) => new()
    {
        BasketId = row.BasketId,
        ConnectionId = row.ConnectionId,
        Kind = ParseKind(row.Kind),
        Name = row.Name,
        SystemId = row.SystemId,
        Enabled = row.Enabled,
        Rule = row.Patterns is null
            ? null
            : new BasketRule
            {
                Patterns = row.Patterns,
                SecType = row.SecType,
                BoardId = row.BoardId,
            },
        CreatedAt = row.CreatedAt,
        UpdatedAt = row.UpdatedAt,
    };

    private static BasketKind ParseKind(string kind) => kind switch
    {
        "static" => BasketKind.Static,
        "dynamic" => BasketKind.Dynamic,
        "system" => BasketKind.System,
        _ => throw new InvalidOperationException($"Unknown basket kind '{kind}'."),
    };

    private sealed class BasketRow
    {
        public long BasketId { get; init; }
        public long ConnectionId { get; init; }
        public required string Kind { get; init; }
        public required string Name { get; init; }
        public string? SystemId { get; init; }
        public bool Enabled { get; init; }
        public DateTimeOffset CreatedAt { get; init; }
        public DateTimeOffset UpdatedAt { get; init; }
        public string[]? Patterns { get; init; }
        public string? SecType { get; init; }
        public string? BoardId { get; init; }
    }
}
