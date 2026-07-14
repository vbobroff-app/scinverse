using Dapper;
using Npgsql;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>Хранилище справочника инструментов в PostgreSQL/TimescaleDB.</summary>
public sealed class InstrumentStore(NpgsqlDataSource dataSource) : IInstrumentStore
{
    static InstrumentStore() => DateOnlyTypeHandler.Register();

    private const string SelectColumns =
        "instrument_id AS InstrumentId, ticker AS Ticker, board_id AS BoardId, " +
        "min_step AS MinStep, decimals AS Decimals, lot_size AS LotSize";

    public async Task<IReadOnlyList<Instrument>> LoadAllAsync(CancellationToken cancellationToken)
    {
        var sql = $"SELECT {SelectColumns} FROM instrument WHERE active = TRUE;";

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<InstrumentRow>(
            new CommandDefinition(sql, cancellationToken: cancellationToken));

        return rows.Select(Map).ToList();
    }

    public async Task<InstrumentCatalogPage> QueryAsync(InstrumentQuery query, CancellationToken cancellationToken)
    {
        var limit = Math.Clamp(query.Limit, 1, 500);
        var offset = Math.Max(0, query.Offset);
        var search = string.IsNullOrWhiteSpace(query.Search) ? null : $"%{query.Search.Trim()}%";
        var board = string.IsNullOrWhiteSpace(query.Board) ? null : query.Board;
        var secType = string.IsNullOrWhiteSpace(query.SecType) ? null : query.SecType;

        var secTypes = CategoryToSecTypes(query.Category);
        var hasCategory = secTypes is not null;

        // Массивы всегда передаём непустыми (Npgsql не выводит тип у null-массива — см. secTypes),
        // а применение фильтра включаем булевым флагом. Пустой @boards при boardsFilter=true даёт
        // пустую выборку (выбраны только не-MOEX биржи, бордов которых ещё нет).
        var instrumentIdsFilter = query.InstrumentIds is { Count: > 0 };
        var instrumentIds = instrumentIdsFilter ? query.InstrumentIds!.ToArray() : [];
        var boardsList = ExchangeCatalog.BoardsFilter(query.Exchanges);
        var boardsFilter = boardsList is not null;
        var boards = boardsList?.ToArray() ?? [];

        // Опционы прячем из плоского списка (они доступны только через дерево фьючерса),
        // кроме явного запроса страйков (underlyingId) / OPT / категории «options».
        var hideOptions = query.UnderlyingId is null
            && !string.Equals(secType, "OPT", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(query.Category, "options", StringComparison.OrdinalIgnoreCase);

        // COUNT(*) OVER() отдаёт общее число под фильтром до LIMIT — без отдельного запроса.
        // LEFT JOIN derivative — фильтр серии (underlying_id/expiration) и подпись листьев.
        const string whereClause = """
            FROM instrument i
            LEFT JOIN derivative d ON d.instrument_id = i.instrument_id
            WHERE (@search  IS NULL OR i.ticker ILIKE @search OR i.short_name ILIKE @search OR i.name ILIKE @search)
              AND (@board   IS NULL OR i.board_id = @board)
              AND (@secType IS NULL OR i.sec_type = @secType)
              AND (NOT @hasCategory OR i.sec_type = ANY(@secTypes))
              AND (NOT @hideOptions OR i.sec_type IS DISTINCT FROM 'OPT')
              AND (@underlyingId IS NULL OR d.underlying_id = @underlyingId)
              AND (@expiration::date IS NULL OR d.expiration = @expiration::date)
              AND (NOT @onlyRecording OR EXISTS (
                    SELECT 1 FROM coverage_segment cs
                    WHERE cs.instrument_id = i.instrument_id AND cs.ended_at IS NULL))
              AND (NOT @nonEmpty OR EXISTS (
                    SELECT 1 FROM coverage_segment cs
                    WHERE cs.instrument_id = i.instrument_id))
              AND (NOT @instrumentIdsFilter OR i.instrument_id = ANY(@instrumentIds))
              AND (NOT @boardsFilter OR i.board_id = ANY(@boards))
            """;

        var sql = $"""
            SELECT i.instrument_id AS InstrumentId, i.ticker AS Ticker, i.board_id AS Board,
                   i.sec_type AS SecType, i.short_name AS ShortName, i.name AS Name, i.min_step AS MinStep,
                   i.decimals AS Decimals, i.active AS Active,
                   d.strike AS Strike, d.option_type AS OptionType, d.expiration AS Expiration,
                   EXISTS (SELECT 1 FROM derivative od
                           WHERE od.underlying_id = i.instrument_id AND od.option_type IS NOT NULL) AS HasOptions,
                   EXISTS (SELECT 1 FROM coverage_segment cs
                           WHERE cs.instrument_id = i.instrument_id AND cs.ended_at IS NULL) AS Recording,
                   COUNT(*) OVER() AS Total
            {whereClause}
            ORDER BY i.ticker, i.board_id
            LIMIT @limit OFFSET @offset;
            """;

        var parameters = new
        {
            search, board, secType,
            hasCategory, secTypes = secTypes ?? [], hideOptions,
            underlyingId = query.UnderlyingId, expiration = query.Expiration,
            onlyRecording = query.OnlyRecording, nonEmpty = query.NonEmpty,
            instrumentIdsFilter, instrumentIds, boardsFilter, boards, limit, offset
        };

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = (await connection.QueryAsync<InstrumentCatalogRow>(
            new CommandDefinition(sql, parameters, cancellationToken: cancellationToken))).ToList();

        // Пустая страница (например, offset за пределами) — total берём отдельным COUNT.
        var total = rows.Count > 0
            ? rows[0].Total
            : await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                $"SELECT COUNT(*) {whereClause}", parameters, cancellationToken: cancellationToken));

        var items = rows.Select(r => new InstrumentCatalogItem
        {
            InstrumentId = r.InstrumentId,
            Ticker = r.Ticker,
            Board = r.Board,
            SecType = r.SecType,
            ShortName = r.ShortName,
            Name = r.Name,
            MinStep = r.MinStep,
            Decimals = r.Decimals ?? 0,
            Active = r.Active,
            Recording = r.Recording,
            HasOptions = r.HasOptions,
            Strike = r.Strike,
            OptionType = string.IsNullOrEmpty(r.OptionType) ? null : r.OptionType[0],
            Expiration = r.Expiration
        }).ToList();

        return new InstrumentCatalogPage(items, total, limit, offset);
    }

    public async Task<InstrumentScopeInfo?> GetScopeInfoAsync(long instrumentId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<InstrumentScopeInfo>(new CommandDefinition(
            """
            SELECT i.board_id AS Board, i.sec_type AS SecType, d.underlying_code AS UnderlyingCode
            FROM instrument i
            LEFT JOIN derivative d ON d.instrument_id = i.instrument_id
            WHERE i.instrument_id = @instrumentId;
            """,
            new { instrumentId },
            cancellationToken: cancellationToken));
    }

    public async Task<IReadOnlyList<InstrumentGroup>> QueryGroupsAsync(GroupQuery query, CancellationToken cancellationToken)
    {
        // Единственный уровень дерева: серии опционов под конкретным фьючерсом (underlying_id).
        // Тикер (краткий код) любого опциона серии несёт признак недельности (поле «W»).
        const string sql = """
            SELECT to_char(d.expiration, 'YYYY-MM-DD') AS Key,
                   MAX(d.underlying_code) AS UnderlyingCode,
                   MAX(i.ticker) AS AnyShortCode,
                   COUNT(*) AS Count, d.expiration AS Expiration
            FROM derivative d
            JOIN instrument i ON i.instrument_id = d.instrument_id
            WHERE d.underlying_id = @underlyingId AND d.option_type IS NOT NULL
            GROUP BY d.expiration
            ORDER BY d.expiration;
            """;

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<InstrumentGroupRow>(
            new CommandDefinition(sql, new { underlyingId = query.UnderlyingId }, cancellationToken: cancellationToken));

        return rows.Select(r =>
        {
            var week = MoexSeries.WeekFromShortCode(r.AnyShortCode);
            return new InstrumentGroup
            {
                Key = r.Key,
                Label = r.Expiration is { } exp ? MoexSeries.Label(r.UnderlyingCode, exp) : r.Key,
                Badge = r.Expiration is { } e ? MoexSeries.Badge(e, week) : null,
                Count = r.Count,
                Expiration = r.Expiration
            };
        }).ToList();
    }

    /// <summary>Категория верхнего уровня (Finam-стиль) → набор sec_type; null — без фильтра.</summary>
    private static string[]? CategoryToSecTypes(string? category) => category?.Trim().ToLowerInvariant() switch
    {
        "futures" => ["FUT"],
        "shares" => ["SHARE"],
        "bonds" => ["BOND"],
        "currency" => ["CURRENCY"],
        "index" => ["INDEX"],
        "options" => ["OPT"],
        _ => null
    };

    public async Task<IReadOnlyList<SecurityInfo>> LoadDerivativeCandidatesAsync(CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT ticker AS Ticker, board_id AS Board, transaq_secid AS TransaqSecId,
                   short_name AS ShortName, name AS Name, sec_type AS SecType,
                   COALESCE(decimals, 0) AS Decimals, min_step AS MinStep, lot_size AS LotSize,
                   point_cost AS PointCost, currency AS Currency
            FROM instrument
            WHERE sec_type IN ('FUT', 'OPT');
            """;

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<SecurityRow>(
            new CommandDefinition(sql, cancellationToken: cancellationToken));

        return rows.Select(r => new SecurityInfo
        {
            Key = new InstrumentKey(r.Ticker, r.Board),
            TransaqSecId = r.TransaqSecId,
            ShortName = r.ShortName,
            Name = r.Name,
            SecType = r.SecType,
            Decimals = r.Decimals,
            MinStep = r.MinStep,
            LotSize = r.LotSize,
            PointCost = r.PointCost,
            Currency = r.Currency
        }).ToList();
    }

    public async Task<Instrument> UpsertAsync(SecurityInfo security, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
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
                (ticker, board_id, transaq_secid, short_name, name, sec_type,
                 decimals, min_step, lot_size, point_cost, currency, last_seen_at)
            VALUES
                (@ticker, @board, @secid, @shortName, @name, @secType,
                 @decimals, @minStep, @lotSize, @pointCost, @currency, now())
            ON CONFLICT (ticker, board_id) DO UPDATE SET
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
                ticker = security.Key.Ticker,
                board = security.Key.Board,
                secid = security.TransaqSecId,
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

        if (security is { UnderlyingCode: not null, Expiration: { } expiration })
        {
            await UpsertDerivativeAsync(connection, transaction, row.InstrumentId, security, expiration, cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return Map(row);
    }

    private static async Task UpsertDerivativeAsync(
        NpgsqlConnection connection, System.Data.Common.DbTransaction transaction,
        long instrumentId, SecurityInfo security, DateOnly expiration, CancellationToken cancellationToken)
    {
        // underlying_id — best-effort: базовый фьючерс резолвим по short_name (реальный MOEX)
        // либо по тикеру (синтетика). Может отсутствовать (спот/индекс) — тогда NULL.
        const string sql = """
            INSERT INTO derivative
                (instrument_id, underlying_id, underlying_code, expiration, option_type, strike)
            SELECT @instrumentId,
                   (SELECT instrument_id FROM instrument
                    WHERE sec_type = 'FUT'
                      AND (short_name = @underlyingShortName OR ticker = @underlyingFut)
                    ORDER BY (short_name = @underlyingShortName) DESC
                    LIMIT 1),
                   @underlyingCode, @expiration, @optionType, @strike
            ON CONFLICT (instrument_id) DO UPDATE SET
                underlying_id   = COALESCE(EXCLUDED.underlying_id, derivative.underlying_id),
                underlying_code = EXCLUDED.underlying_code,
                expiration      = EXCLUDED.expiration,
                option_type     = EXCLUDED.option_type,
                strike          = EXCLUDED.strike;
            """;

        await connection.ExecuteAsync(new CommandDefinition(
            sql,
            new
            {
                instrumentId,
                underlyingFut = security.UnderlyingFuturesCode,
                underlyingShortName = security.UnderlyingShortName,
                underlyingCode = security.UnderlyingCode,
                expiration,
                optionType = security.OptionType?.ToString(),
                strike = security.Strike
            },
            transaction,
            cancellationToken: cancellationToken));
    }

    private static Instrument Map(InstrumentRow row) => new()
    {
        InstrumentId = row.InstrumentId,
        Key = new InstrumentKey(row.Ticker, row.BoardId),
        MinStep = row.MinStep,
        Decimals = row.Decimals ?? 0,
        LotSize = row.LotSize
    };
}
