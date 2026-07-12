using Microsoft.Extensions.Caching.Memory;
using Scinverse.Ohs.Domain.Moex;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Каталог структуры биржи поверх публичного MOEX ISS (typed <see cref="HttpClient"/>).
/// Ответы кэшируются в памяти (структура биржи меняется редко; списки инструментов — раз в день),
/// поэтому повторные запросы не бьют в ISS. Отдаёт доменные модели, не сырой ISS-формат.
///
/// TODO (7c.3): персистентный кэш в БД + инвалидация по <c>updatetime</c> для авторитетного
/// отслеживания обновлений; пока — TTL в памяти.
/// </summary>
public sealed class IssExchangeCatalog(HttpClient http, IMemoryCache cache, ILogger<IssExchangeCatalog> logger)
    : IExchangeCatalog
{
    private static readonly TimeSpan StructureTtl = TimeSpan.FromHours(6);
    private static readonly TimeSpan SecuritiesTtl = TimeSpan.FromMinutes(30);

    public Task<IReadOnlyList<IssEngine>> GetEnginesAsync(CancellationToken cancellationToken) =>
        GetOrFetchAsync("engines", "engines.json?iss.meta=off&lang=ru", StructureTtl, static table =>
            table.Rows
                .Select(r => new IssEngine(r.GetString("name") ?? string.Empty, r.GetString("title") ?? string.Empty))
                .Where(e => e.Name.Length > 0)
                .ToList(),
            cancellationToken);

    public Task<IReadOnlyList<IssMarket>> GetMarketsAsync(string engine, CancellationToken cancellationToken) =>
        GetOrFetchAsync(
            $"markets:{engine}",
            $"engines/{Esc(engine)}/markets.json?iss.meta=off&lang=ru",
            StructureTtl,
            static table =>
                table.Rows
                    .Select(r => new IssMarket(
                        r.GetString("NAME") ?? r.GetString("name") ?? string.Empty,
                        r.GetString("title") ?? string.Empty))
                    .Where(m => m.Name.Length > 0)
                    .ToList(),
            cancellationToken);

    public Task<IReadOnlyList<IssBoard>> GetBoardsAsync(
        string engine, string market, CancellationToken cancellationToken) =>
        GetOrFetchAsync(
            $"boards:{engine}/{market}",
            $"engines/{Esc(engine)}/markets/{Esc(market)}/boards.json?iss.meta=off&lang=ru",
            StructureTtl,
            static table =>
                table.Rows
                    .Select(r => new IssBoard(
                        r.GetString("boardid") ?? string.Empty,
                        r.GetString("title") ?? string.Empty,
                        r.GetBool("is_traded")))
                    .Where(b => b.BoardId.Length > 0)
                    .ToList(),
            cancellationToken);

    public Task<IReadOnlyList<IssSecurity>> GetBoardSecuritiesAsync(
        string engine, string market, string board, CancellationToken cancellationToken) =>
        GetOrFetchAsync(
            $"securities:{engine}/{market}/{board}",
            $"engines/{Esc(engine)}/markets/{Esc(market)}/boards/{Esc(board)}/securities.json?iss.only=securities&iss.meta=off&lang=ru",
            SecuritiesTtl,
            static table =>
                table.Rows
                    .Select(r => new IssSecurity(
                        r.GetString("SECID") ?? string.Empty,
                        r.GetString("SHORTNAME"),
                        r.GetString("SECNAME") ?? r.GetString("NAME"),
                        r.GetDecimal("MINSTEP"),
                        r.GetInt("LOTSIZE"),
                        (short?)r.GetInt("DECIMALS"),
                        r.GetString("ASSETCODE")))
                    .Where(s => s.SecId.Length > 0)
                    .ToList(),
            cancellationToken);

    public Task<IReadOnlyList<IssFuturesRef>> GetFortsFuturesAsync(CancellationToken cancellationToken) =>
        GetOrFetchAsync(
            "forts-futures",
            "engines/futures/markets/forts/securities.json?iss.only=securities&iss.meta=off&lang=ru",
            SecuritiesTtl,
            static table =>
                table.Rows
                    .Select(r => new IssFuturesRef(
                        r.GetString("SECID") ?? string.Empty,
                        r.GetString("ASSETCODE"),
                        r.GetString("SHORTNAME")))
                    .Where(f => f.SecId.Length > 0)
                    .ToList(),
            cancellationToken);

    public async Task<string?> ResolveAssetGroupAsync(string assetCode, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(assetCode))
        {
            return null;
        }

        var cacheKey = $"asset-group:{assetCode}";
        if (cache.TryGetValue<string?>(cacheKey, out var cached))
        {
            return cached;
        }

        string? group = null;
        try
        {
            var url = $"securities.json?q={Esc(assetCode)}&iss.meta=off&lang=ru";
            var json = await http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            var table = IssTable.Parse(json, "securities");

            // Точное совпадение по secid приоритетнее, иначе — первая строка выдачи.
            IssRow? match = null;
            foreach (var row in table.Rows)
            {
                match ??= row;
                if (string.Equals(row.GetString("secid"), assetCode, StringComparison.OrdinalIgnoreCase))
                {
                    match = row;
                    break;
                }
            }

            group = match?.GetString("group");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            logger.LogDebug(ex, "ISS resolve group failed for {AssetCode}", assetCode);
        }

        // Кэшируем и отрицательный результат (короче), чтобы не долбить ISS повторно в рамках рефреша.
        cache.Set(cacheKey, group, group is null ? TimeSpan.FromMinutes(2) : SecuritiesTtl);
        return group;
    }

    private async Task<IReadOnlyList<T>> GetOrFetchAsync<T>(
        string cacheKey,
        string relativeUrl,
        TimeSpan ttl,
        Func<IssTable, List<T>> map,
        CancellationToken cancellationToken)
    {
        if (cache.TryGetValue<IReadOnlyList<T>>(cacheKey, out var cached) && cached is not null)
        {
            return cached;
        }

        var tableName = relativeUrl.Split('/')[^1].Split('.')[0];
        var json = await http.GetStringAsync(relativeUrl, cancellationToken).ConfigureAwait(false);
        var table = IssTable.Parse(json, tableName);
        var result = map(table);

        logger.LogDebug("ISS {Url}: {Count} rows in table '{Table}'", relativeUrl, result.Count, tableName);
        cache.Set(cacheKey, (IReadOnlyList<T>)result, ttl);
        return result;
    }

    private static string Esc(string segment) => Uri.EscapeDataString(segment);
}
