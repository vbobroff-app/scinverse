using Dapper;
using Npgsql;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>Bracketing WriteHole из <c>md_trade</c>: last before / first after ядра.</summary>
public sealed class TradeBracketStore(NpgsqlDataSource dataSource) : ITradeBracketStore
{
    private sealed record Row(
        long InstrumentId,
        DateTime Before,
        DateTime After,
        DateTime? LastBefore,
        DateTime? FirstAfter);

    public async Task<IReadOnlyList<TradeBracket>> QueryBracketsAsync(
        short sourceId,
        IReadOnlyList<TradeBracketRequest> requests,
        CancellationToken cancellationToken)
    {
        if (requests.Count == 0)
        {
            return [];
        }

        var instrumentIds = new long[requests.Count];
        var windowFroms = new DateTime[requests.Count];
        var befores = new DateTime[requests.Count];
        var afters = new DateTime[requests.Count];
        var windowTos = new DateTime[requests.Count];

        for (var i = 0; i < requests.Count; i++)
        {
            var r = requests[i];
            instrumentIds[i] = r.InstrumentId;
            windowFroms[i] = r.WindowFrom.ToUniversalTime().UtcDateTime;
            befores[i] = r.Before.ToUniversalTime().UtcDateTime;
            afters[i] = r.After.ToUniversalTime().UtcDateTime;
            windowTos[i] = r.WindowTo.ToUniversalTime().UtcDateTime;
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            """
            WITH req AS (
                SELECT *
                FROM unnest(
                    @instrumentIds::bigint[],
                    @windowFroms::timestamptz[],
                    @befores::timestamptz[],
                    @afters::timestamptz[],
                    @windowTos::timestamptz[])
                    AS t(instrument_id, window_from, before_ts, after_ts, window_to)
            )
            SELECT
                r.instrument_id AS InstrumentId,
                r.before_ts AS Before,
                r.after_ts AS After,
                (
                    SELECT max(t.ts)
                    FROM md_trade t
                    WHERE t.instrument_id = r.instrument_id
                      AND t.source_id = @sourceId
                      AND t.ts >= r.window_from
                      AND t.ts < r.before_ts
                ) AS LastBefore,
                (
                    SELECT min(t.ts)
                    FROM md_trade t
                    WHERE t.instrument_id = r.instrument_id
                      AND t.source_id = @sourceId
                      AND t.ts > r.after_ts
                      AND t.ts <= r.window_to
                ) AS FirstAfter
            FROM req r;
            """,
            new
            {
                sourceId,
                instrumentIds,
                windowFroms,
                befores,
                afters,
                windowTos,
            },
            cancellationToken: cancellationToken));

        return rows
            .Select(r => new TradeBracket(
                r.InstrumentId,
                ToUtc(r.Before),
                ToUtc(r.After),
                r.LastBefore is { } lb ? ToUtc(lb) : null,
                r.FirstAfter is { } fa ? ToUtc(fa) : null))
            .ToList();
    }

    private static DateTimeOffset ToUtc(DateTime value) =>
        new(DateTime.SpecifyKind(value, DateTimeKind.Utc));
}
