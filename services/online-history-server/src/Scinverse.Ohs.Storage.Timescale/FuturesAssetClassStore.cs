using Dapper;
using Npgsql;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>
/// Справочник классов базового актива фьючерсов (futures_asset_class) в PostgreSQL.
/// Авто-рефреш не перезатирает подтверждённые вручную (confirmed=true) строки.
/// </summary>
public sealed class FuturesAssetClassStore(NpgsqlDataSource dataSource) : IFuturesAssetClassStore
{
    public async Task<IReadOnlyList<FuturesAssetClass>> ListAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<FuturesAssetClass>(new CommandDefinition(
            """
            SELECT asset_code  AS AssetCode,
                   category    AS Category,
                   subcategory AS Subcategory,
                   title       AS Title,
                   source      AS Source,
                   confirmed   AS Confirmed
            FROM futures_asset_class
            ORDER BY category, asset_code;
            """,
            cancellationToken: cancellationToken));

        return rows.ToList();
    }

    public async Task<int> UpsertAutoAsync(
        IReadOnlyList<FuturesAssetClass> rows,
        CancellationToken cancellationToken)
    {
        if (rows.Count == 0)
        {
            return 0;
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        // Не перезатираем ручное курирование: обновляем поля только у строк с confirmed=false.
        // Возвращаем xmax=0 (признак свежей вставки), чтобы посчитать, сколько НОВЫХ кодов добавлено.
        var inserted = 0;
        foreach (var row in rows)
        {
            // Для confirmed=true строк ON CONFLICT ... WHERE не срабатывает → RETURNING пуст (null = пропущено).
            var isInsert = await connection.QuerySingleOrDefaultAsync<bool?>(new CommandDefinition(
                """
                INSERT INTO futures_asset_class
                    (asset_code, category, subcategory, title, source, confirmed, updated_at)
                VALUES (@AssetCode, @Category, @Subcategory, @Title, @Source, FALSE, now())
                ON CONFLICT (asset_code) DO UPDATE SET
                    category    = EXCLUDED.category,
                    subcategory = EXCLUDED.subcategory,
                    title       = EXCLUDED.title,
                    source      = EXCLUDED.source,
                    updated_at  = now()
                WHERE futures_asset_class.confirmed = FALSE
                RETURNING (xmax = 0) AS inserted;
                """,
                row,
                cancellationToken: cancellationToken));

            if (isInsert == true)
            {
                inserted++;
            }
        }

        return inserted;
    }
}
