using System.Globalization;
using System.Text.Json;
using Dapper;
using Npgsql;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>
/// Версионная история торгового распорядка по движку (market_schedule) в PostgreSQL.
/// Время/дата читаются как <c>::text</c> (у Dapper нет карты <see cref="TimeOnly"/>), фазы —
/// из JSONB. Дата запроса передаётся строкой с приведением <c>::date</c>.
/// </summary>
public sealed class MarketScheduleStore(NpgsqlDataSource dataSource) : IMarketScheduleStore
{
    /// <summary>Канонический порядок будних фаз (для стабильной раскладки чипов независимо от JSONB).</summary>
    private static readonly string[] WeekdayOrder = ["auction", "morning", "main", "evening"];

    /// <summary>Порядок фаз выходного дня (ДСВД).</summary>
    private static readonly string[] WeekendOrder = ["weekend"];

    private sealed record Row(
        string Market,
        string EffectiveFrom,
        string WdOpen,
        string WdClose,
        string? WeOpen,
        string? WeClose,
        string? Phases,
        string Confidence,
        string? Source,
        string? Note);

    public async Task<MarketScheduleVersion?> GetActiveAsync(
        string market, DateOnly on, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        // Базовый профиль РЫНКА: строка market-уровня (под-scope NULL), действующая на дату. Специфичные
        // строки (sec_type/category/instrument) — забота резолвера записи, здесь показываем «дефолт рынка».
        var row = await connection.QuerySingleOrDefaultAsync<Row>(new CommandDefinition(
            """
            SELECT market              AS Market,
                   effective_from::text AS EffectiveFrom,
                   wd_open::text        AS WdOpen,
                   wd_close::text       AS WdClose,
                   we_open::text        AS WeOpen,
                   we_close::text       AS WeClose,
                   phases::text         AS Phases,
                   confidence           AS Confidence,
                   source               AS Source,
                   note                 AS Note
            FROM market_schedule
            WHERE market = @market
              AND sec_type IS NULL AND category IS NULL AND instrument IS NULL
              AND effective_from <= @on::date
            ORDER BY effective_from DESC
            LIMIT 1;
            """,
            new { market, on = on.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) },
            cancellationToken: cancellationToken));

        if (row is null)
        {
            return null;
        }

        var phases = ParsePhases(row.Phases);
        return new MarketScheduleVersion(
            row.Market,
            DateOnly.ParseExact(row.EffectiveFrom, "yyyy-MM-dd", CultureInfo.InvariantCulture),
            ParseTime(row.WdOpen)!.Value,
            ParseTime(row.WdClose)!.Value,
            ParseTime(row.WeOpen),
            ParseTime(row.WeClose),
            BuildPhases(phases, WeekdayOrder),
            BuildPhases(phases, WeekendOrder),
            row.Confidence,
            row.Source,
            row.Note);
    }

    private sealed record ExcRow(
        string ExcDate,
        string Market,
        string? SecType,
        string? Category,
        string? Instrument,
        string Kind,
        string? OpenTime,
        string? CloseTime,
        string Confidence,
        string? Source,
        bool Resolved,
        string? Note);

    public async Task<IReadOnlyList<MarketScheduleException>> ListExceptionsAsync(
        string market, bool onlyUnresolved, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<ExcRow>(new CommandDefinition(
            """
            SELECT exc_date::text   AS ExcDate,
                   market           AS Market,
                   sec_type         AS SecType,
                   category         AS Category,
                   instrument       AS Instrument,
                   kind             AS Kind,
                   open_time::text  AS OpenTime,
                   close_time::text AS CloseTime,
                   confidence       AS Confidence,
                   source           AS Source,
                   resolved         AS Resolved,
                   note             AS Note
            FROM market_schedule_exception
            WHERE market = @market
              AND (@onlyUnresolved = FALSE OR resolved = FALSE)
            ORDER BY exc_date DESC, exception_id DESC;
            """,
            new { market, onlyUnresolved },
            cancellationToken: cancellationToken));

        return rows.Select(r => new MarketScheduleException(
            DateOnly.ParseExact(r.ExcDate, "yyyy-MM-dd", CultureInfo.InvariantCulture),
            r.Market, r.SecType, r.Category, r.Instrument, r.Kind,
            ParseTime(r.OpenTime), ParseTime(r.CloseTime),
            r.Confidence, r.Source, r.Resolved, r.Note)).ToList();
    }

    public async Task<MarketScheduleVersion?> ResolveAsync(
        ScheduleScope scope, DateOnly on, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        // Самая специфичная строка: scope-колонка либо совпадает с запросом, либо NULL (wildcard). Порядок
        // специфичности: instrument → category → sec_type → market-дефолт; при равной — свежее effective_from.
        var row = await connection.QuerySingleOrDefaultAsync<Row>(new CommandDefinition(
            """
            SELECT market              AS Market,
                   effective_from::text AS EffectiveFrom,
                   wd_open::text        AS WdOpen,
                   wd_close::text       AS WdClose,
                   we_open::text        AS WeOpen,
                   we_close::text       AS WeClose,
                   phases::text         AS Phases,
                   confidence           AS Confidence,
                   source               AS Source,
                   note                 AS Note
            FROM market_schedule
            WHERE market = @market
              AND (sec_type   IS NULL OR sec_type   = @secType)
              AND (category   IS NULL OR category   = @category)
              AND (instrument IS NULL OR instrument = @instrument)
              AND effective_from <= @on::date
            ORDER BY (instrument IS NOT NULL) DESC,
                     (category   IS NOT NULL) DESC,
                     (sec_type   IS NOT NULL) DESC,
                     effective_from DESC
            LIMIT 1;
            """,
            new
            {
                market = scope.Market,
                secType = scope.SecType,
                category = scope.Category,
                instrument = scope.Instrument,
                on = on.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            },
            cancellationToken: cancellationToken));

        if (row is null)
        {
            return null;
        }

        var phases = ParsePhases(row.Phases);
        return new MarketScheduleVersion(
            row.Market,
            DateOnly.ParseExact(row.EffectiveFrom, "yyyy-MM-dd", CultureInfo.InvariantCulture),
            ParseTime(row.WdOpen)!.Value,
            ParseTime(row.WdClose)!.Value,
            ParseTime(row.WeOpen),
            ParseTime(row.WeClose),
            BuildPhases(phases, WeekdayOrder),
            BuildPhases(phases, WeekendOrder),
            row.Confidence,
            row.Source,
            row.Note);
    }

    public async Task UpsertExceptionAsync(MarketScheduleException exception, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO market_schedule_exception
                (exc_date, market, sec_type, category, instrument, kind,
                 open_time, close_time, confidence, source, resolved, note)
            VALUES
                (@excDate::date, @market, @secType, @category, @instrument, @kind,
                 @openTime::time, @closeTime::time, @confidence, @source, FALSE, @note)
            ON CONFLICT (market, COALESCE(sec_type, ''), COALESCE(category, ''), COALESCE(instrument, ''), exc_date)
            DO UPDATE SET
                kind       = EXCLUDED.kind,
                open_time  = EXCLUDED.open_time,
                close_time = EXCLUDED.close_time,
                confidence = EXCLUDED.confidence,
                source     = EXCLUDED.source,
                note       = EXCLUDED.note
            WHERE market_schedule_exception.resolved = FALSE;
            """,
            new
            {
                excDate = exception.ExcDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                market = exception.Market,
                secType = exception.SecType,
                category = exception.Category,
                instrument = exception.Instrument,
                kind = exception.Kind,
                openTime = exception.OpenTime?.ToString("HH:mm:ss", CultureInfo.InvariantCulture),
                closeTime = exception.CloseTime?.ToString("HH:mm:ss", CultureInfo.InvariantCulture),
                confidence = exception.Confidence,
                source = exception.Source,
                note = exception.Note,
            },
            cancellationToken: cancellationToken));
    }

    /// <summary>Парсит PostgreSQL <c>time</c> (в тексте <c>HH:mm:ss</c>) в <see cref="TimeOnly"/>; null → null.</summary>
    private static TimeOnly? ParseTime(string? text) =>
        string.IsNullOrWhiteSpace(text)
            ? null
            : TimeOnly.Parse(text, CultureInfo.InvariantCulture);

    /// <summary>Разбирает JSONB <c>phases</c> (<c>{"main":{"from":"10:00","till":"19:00"},…}</c>) в карту ключ→окно.</summary>
    private static Dictionary<string, (TimeOnly From, TimeOnly Till)> ParsePhases(string? json)
    {
        var result = new Dictionary<string, (TimeOnly, TimeOnly)>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(json))
        {
            return result;
        }

        using var doc = JsonDocument.Parse(json);
        foreach (var prop in doc.RootElement.EnumerateObject())
        {
            var from = prop.Value.TryGetProperty("from", out var f) ? f.GetString() : null;
            var till = prop.Value.TryGetProperty("till", out var t) ? t.GetString() : null;
            if (TimeOnly.TryParse(from, CultureInfo.InvariantCulture, out var fromTime)
                && TimeOnly.TryParse(till, CultureInfo.InvariantCulture, out var tillTime))
            {
                result[prop.Name] = (fromTime, tillTime);
            }
        }

        return result;
    }

    /// <summary>Собирает фазы в заданном каноническом порядке, пропуская отсутствующие в JSONB.</summary>
    private static List<SchedulePhase> BuildPhases(
        Dictionary<string, (TimeOnly From, TimeOnly Till)> phases, string[] order)
    {
        var list = new List<SchedulePhase>(order.Length);
        foreach (var key in order)
        {
            if (phases.TryGetValue(key, out var window))
            {
                list.Add(new SchedulePhase(key, window.From, window.Till));
            }
        }

        return list;
    }
}
