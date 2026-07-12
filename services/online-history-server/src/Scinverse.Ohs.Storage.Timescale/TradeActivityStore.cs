using Dapper;
using Npgsql;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>
/// Присутствие сделок по бакетам (time_bucket) из md_trade с кэшем закрытых дней.
/// Закрытые полные дни (прошлое) кэшируются в trade_activity_bucket (+ маркер посчитанного дня
/// в trade_activity_computed), текущий день считается на лету. Возвращает только непустые бакеты
/// (разрыв = отсутствие бакета).
/// </summary>
public sealed class TradeActivityStore(NpgsqlDataSource dataSource, TimeProvider timeProvider) : ITradeActivityStore
{
    // Bucket маппится как DateTime (Npgsql отдаёт timestamptz как DateTime Utc); наружу — DateTimeOffset.
    private sealed record Row(long InstrumentId, DateTime Bucket);

    private static DateTimeOffset ToUtcOffset(DateTime bucket) =>
        new(DateTime.SpecifyKind(bucket, DateTimeKind.Unspecified), TimeSpan.Zero);

    public async Task<IReadOnlyList<InstrumentActivity>> QueryActivityAsync(
        IReadOnlyCollection<long> instrumentIds, short sourceId,
        DateTimeOffset from, DateTimeOffset to, TimeSpan bucket, CancellationToken cancellationToken)
    {
        if (instrumentIds.Count == 0)
        {
            return [];
        }

        var ids = instrumentIds.Distinct().ToArray();
        var fromUtc = from.ToUniversalTime();
        var toUtc = to.ToUniversalTime();
        var todayStartUtc = new DateTimeOffset(timeProvider.GetUtcNow().UtcDateTime.Date, TimeSpan.Zero);

        // Кэшируем только закрытые (полностью прошедшие) дни; текущий день — на лету.
        var closedTo = toUtc < todayStartUtc ? toUtc : todayStartUtc;

        var result = ids.ToDictionary(id => id, _ => new List<DateTimeOffset>());

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        // 1) Закрытая часть — из кэша (с досчётом недостающих дней).
        if (closedTo > fromUtc)
        {
            await EnsureCachedAsync(connection, ids, sourceId, fromUtc, closedTo, bucket, cancellationToken);

            var cached = await connection.QueryAsync<Row>(new CommandDefinition(
                """
                SELECT instrument_id AS InstrumentId, bucket_ts AS Bucket
                FROM trade_activity_bucket
                WHERE instrument_id = ANY(@ids) AND source_id = @sourceId
                  AND bucket_size = @bucket AND bucket_ts >= @from AND bucket_ts < @to
                ORDER BY instrument_id, bucket_ts;
                """,
                new { ids, sourceId, bucket, from = fromUtc, to = closedTo },
                cancellationToken: cancellationToken));

            foreach (var r in cached)
            {
                result[r.InstrumentId].Add(ToUtcOffset(r.Bucket));
            }
        }

        // 2) Живая часть [max(from, today), to) — на лету, без кэша.
        var liveFrom = fromUtc > todayStartUtc ? fromUtc : todayStartUtc;
        if (toUtc > liveFrom)
        {
            var live = await QueryBucketsAsync(connection, ids, sourceId, liveFrom, toUtc, bucket, cancellationToken);
            foreach (var r in live)
            {
                result[r.InstrumentId].Add(ToUtcOffset(r.Bucket));
            }
        }

        return ids
            .Select(id => new InstrumentActivity { InstrumentId = id, Buckets = result[id] })
            .ToList();
    }

    /// <summary>Прямой расчёт непустых бакетов из md_trade (без кэша).</summary>
    private static async Task<IReadOnlyList<Row>> QueryBucketsAsync(
        NpgsqlConnection connection, long[] ids, short sourceId,
        DateTimeOffset from, DateTimeOffset to, TimeSpan bucket, CancellationToken cancellationToken)
    {
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            """
            SELECT instrument_id AS InstrumentId, time_bucket(@bucket, ts) AS Bucket
            FROM md_trade
            WHERE instrument_id = ANY(@ids) AND source_id = @sourceId AND ts >= @from AND ts < @to
            GROUP BY instrument_id, time_bucket(@bucket, ts)
            ORDER BY instrument_id, Bucket;
            """,
            new { ids, sourceId, from = from.ToUniversalTime(), to = to.ToUniversalTime(), bucket },
            cancellationToken: cancellationToken));

        return rows.ToList();
    }

    /// <summary>
    /// Досчитывает и кэширует закрытые дни [from, to), которых ещё нет в trade_activity_computed:
    /// вставляет непустые бакеты, затем маркеры посчитанных дней (в т.ч. пустых). Идемпотентно.
    /// </summary>
    private static async Task EnsureCachedAsync(
        NpgsqlConnection connection, long[] ids, short sourceId,
        DateTimeOffset from, DateTimeOffset to, TimeSpan bucket, CancellationToken cancellationToken)
    {
        var firstDay = DateOnly.FromDateTime(from.UtcDateTime);
        var lastDay = DateOnly.FromDateTime(to.AddTicks(-1).UtcDateTime);
        var spanFrom = new DateTimeOffset(firstDay.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        var spanTo = spanFrom.AddDays((lastDay.DayNumber - firstDay.DayNumber) + 1);

        await using var tx = await connection.BeginTransactionAsync(cancellationToken);

        // Непустые бакеты только для (id, day), которые ещё не посчитаны.
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO trade_activity_bucket (instrument_id, source_id, bucket_size, bucket_ts)
            SELECT t.instrument_id, @sourceId, @bucket, time_bucket(@bucket, t.ts)
            FROM md_trade t
            WHERE t.source_id = @sourceId AND t.ts >= @spanFrom AND t.ts < @spanTo
              AND (t.instrument_id, (t.ts AT TIME ZONE 'UTC')::date) IN (
                  SELECT i.id, d.day::date
                  FROM unnest(@ids) AS i(id)
                  CROSS JOIN generate_series(@firstDay::timestamp, @lastDay::timestamp, interval '1 day') AS d(day)
                  LEFT JOIN trade_activity_computed c
                    ON c.instrument_id = i.id AND c.source_id = @sourceId
                   AND c.bucket_size = @bucket AND c.day = d.day::date
                  WHERE c.instrument_id IS NULL
              )
            GROUP BY t.instrument_id, time_bucket(@bucket, t.ts)
            ON CONFLICT DO NOTHING;
            """,
            new { ids, sourceId, bucket, spanFrom, spanTo, firstDay, lastDay },
            transaction: tx, cancellationToken: cancellationToken));

        // Маркеры посчитанных дней (в т.ч. пустых) — после вставки бакетов.
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO trade_activity_computed (instrument_id, source_id, bucket_size, day)
            SELECT i.id, @sourceId, @bucket, d.day::date
            FROM unnest(@ids) AS i(id)
            CROSS JOIN generate_series(@firstDay::timestamp, @lastDay::timestamp, interval '1 day') AS d(day)
            LEFT JOIN trade_activity_computed c
              ON c.instrument_id = i.id AND c.source_id = @sourceId
             AND c.bucket_size = @bucket AND c.day = d.day::date
            WHERE c.instrument_id IS NULL
            ON CONFLICT DO NOTHING;
            """,
            new { ids, sourceId, bucket, firstDay, lastDay },
            transaction: tx, cancellationToken: cancellationToken));

        await tx.CommitAsync(cancellationToken);
    }
}
