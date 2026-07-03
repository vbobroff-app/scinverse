using Dapper;
using Npgsql;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>Хранилище справочника инструментов в PostgreSQL/TimescaleDB.</summary>
public sealed class InstrumentStore : IInstrumentStore
{
    private const string SelectColumns =
        "instrument_id AS InstrumentId, seccode AS Seccode, board_id AS BoardId, " +
        "min_step AS MinStep, decimals AS Decimals, lot_size AS LotSize";

    private readonly NpgsqlDataSource _dataSource;

    public InstrumentStore(NpgsqlDataSource dataSource) => _dataSource = dataSource;

    public async Task<IReadOnlyList<Instrument>> LoadAllAsync(CancellationToken cancellationToken)
    {
        var sql = $"SELECT {SelectColumns} FROM instrument WHERE active = TRUE;";

        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<InstrumentRow>(
            new CommandDefinition(sql, cancellationToken: cancellationToken));

        return rows.Select(Map).ToList();
    }

    public async Task<Instrument> UpsertAsync(SecurityInfo security, CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        if (security.MarketId is { } marketId)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                "INSERT INTO market (market_id) VALUES (@id) ON CONFLICT (market_id) DO NOTHING;",
                new { id = marketId }, transaction, cancellationToken: cancellationToken));
        }

        await connection.ExecuteAsync(new CommandDefinition(
            "INSERT INTO board (board_id, market_id) VALUES (@board, @market) ON CONFLICT (board_id) DO NOTHING;",
            new { board = security.Key.Board, market = security.MarketId },
            transaction, cancellationToken: cancellationToken));

        const string upsert = $"""
            INSERT INTO instrument
                (seccode, board_id, market_id, transaq_secid, short_name, name, sec_type,
                 decimals, min_step, lot_size, point_cost, currency, last_seen_at)
            VALUES
                (@seccode, @board, @market, @secid, @shortName, @name, @secType,
                 @decimals, @minStep, @lotSize, @pointCost, @currency, now())
            ON CONFLICT (seccode, board_id) DO UPDATE SET
                market_id     = EXCLUDED.market_id,
                transaq_secid = EXCLUDED.transaq_secid,
                short_name    = EXCLUDED.short_name,
                name          = EXCLUDED.name,
                sec_type      = EXCLUDED.sec_type,
                decimals      = EXCLUDED.decimals,
                min_step      = EXCLUDED.min_step,
                lot_size      = EXCLUDED.lot_size,
                point_cost    = EXCLUDED.point_cost,
                currency      = EXCLUDED.currency,
                active        = TRUE,
                last_seen_at  = now()
            RETURNING {SelectColumns};
            """;

        var row = await connection.QuerySingleAsync<InstrumentRow>(new CommandDefinition(
            upsert,
            new
            {
                seccode = security.Key.Seccode,
                board = security.Key.Board,
                market = security.MarketId,
                secid = security.TransaqSecid,
                shortName = security.ShortName,
                name = security.Name,
                secType = security.SecType,
                decimals = security.Decimals,
                minStep = security.MinStep,
                lotSize = security.LotSize,
                pointCost = security.PointCost,
                currency = security.Currency
            },
            transaction,
            cancellationToken: cancellationToken));

        await transaction.CommitAsync(cancellationToken);
        return Map(row);
    }

    private static Instrument Map(InstrumentRow row) => new()
    {
        InstrumentId = row.InstrumentId,
        Key = new InstrumentKey(row.Seccode, row.BoardId),
        MinStep = row.MinStep,
        Decimals = row.Decimals ?? 0,
        LotSize = row.LotSize
    };
}
