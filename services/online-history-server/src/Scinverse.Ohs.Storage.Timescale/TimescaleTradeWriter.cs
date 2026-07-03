using Npgsql;
using NpgsqlTypes;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>
/// Пакетная запись сделок: COPY (BINARY) во временную таблицу, затем
/// INSERT ... ON CONFLICT DO NOTHING в md_trade (дедупликация по (instrument_id, trade_no, ts)).
/// </summary>
public sealed class TimescaleTradeWriter : ITradeWriter
{
    private const string CreateStage =
        "CREATE TEMP TABLE IF NOT EXISTS _stage_trade " +
        "(ts timestamptz, instrument_id bigint, trade_no bigint, price_ticks bigint, " +
        "quantity int, side smallint, open_interest bigint) ON COMMIT DROP;";

    private const string CopyStage =
        "COPY _stage_trade (ts, instrument_id, trade_no, price_ticks, quantity, side, open_interest) " +
        "FROM STDIN (FORMAT BINARY)";

    private const string InsertFromStage =
        "INSERT INTO md_trade (ts, instrument_id, trade_no, price_ticks, quantity, side, open_interest) " +
        "SELECT ts, instrument_id, trade_no, price_ticks, quantity, side, open_interest FROM _stage_trade " +
        "ON CONFLICT (instrument_id, trade_no, ts) DO NOTHING;";

    private readonly NpgsqlDataSource _dataSource;

    public TimescaleTradeWriter(NpgsqlDataSource dataSource) => _dataSource = dataSource;

    public async Task<int> WriteAsync(IReadOnlyCollection<TradeRecord> trades, CancellationToken cancellationToken)
    {
        if (trades.Count == 0)
        {
            return 0;
        }

        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        await using (var create = new NpgsqlCommand(CreateStage, connection, transaction))
        {
            await create.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var writer = await connection.BeginBinaryImportAsync(CopyStage, cancellationToken))
        {
            foreach (var trade in trades)
            {
                await writer.StartRowAsync(cancellationToken);
                await writer.WriteAsync(trade.Timestamp, NpgsqlDbType.TimestampTz, cancellationToken);
                await writer.WriteAsync(trade.InstrumentId, NpgsqlDbType.Bigint, cancellationToken);
                await writer.WriteAsync(trade.TradeNo, NpgsqlDbType.Bigint, cancellationToken);
                await writer.WriteAsync(trade.PriceTicks, NpgsqlDbType.Bigint, cancellationToken);
                await writer.WriteAsync(trade.Quantity, NpgsqlDbType.Integer, cancellationToken);
                await writer.WriteAsync((short)trade.Side, NpgsqlDbType.Smallint, cancellationToken);

                if (trade.OpenInterest is { } openInterest)
                {
                    await writer.WriteAsync(openInterest, NpgsqlDbType.Bigint, cancellationToken);
                }
                else
                {
                    await writer.WriteNullAsync(cancellationToken);
                }
            }

            await writer.CompleteAsync(cancellationToken);
        }

        int inserted;
        await using (var insert = new NpgsqlCommand(InsertFromStage, connection, transaction))
        {
            inserted = await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return inserted;
    }
}
