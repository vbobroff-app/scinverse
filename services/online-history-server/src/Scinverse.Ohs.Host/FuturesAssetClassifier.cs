using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Domain.Moex;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Актуализация справочника классов базового актива фьючерсов ИЗ ISS (запускается по кнопке).
/// Собирает актуальные ASSETCODE FORTS-фьючерсов, авто-классифицирует (сид-карта s205 → резолв
/// группы спот-актива ISS → «прочее»), делает upsert без перезаписи ручного курирования.
/// </summary>
public sealed class FuturesAssetClassifier(
    IExchangeCatalog catalog,
    IFuturesAssetClassStore store,
    ILogger<FuturesAssetClassifier> logger)
{
    // Резолв спот-группы ISS делаем по КОДУ (их сотни), поэтому ограничиваем и параллелизм, и общий
    // бюджет времени: рефреш обязан вернуться за секунды, иначе браузер/прокси оборвёт запрос.
    private const int ResolveConcurrency = 8;
    private static readonly TimeSpan ResolveBudget = TimeSpan.FromSeconds(20);

    public async Task<AssetClassRefreshSummary> RefreshAsync(CancellationToken cancellationToken)
    {
        var futures = await catalog.GetFortsFuturesAsync(cancellationToken).ConfigureAwait(false);

        // Уникальные коды базового актива + образец имени (для читаемого title, если нет в сид-карте).
        var byCode = futures
            .Where(f => !string.IsNullOrWhiteSpace(f.AssetCode))
            .GroupBy(f => f.AssetCode!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().ShortName, StringComparer.OrdinalIgnoreCase);

        var rows = new List<FuturesAssetClass>(byCode.Count);
        var toResolve = new List<KeyValuePair<string, string?>>();
        foreach (var pair in byCode)
        {
            if (FuturesAssetTaxonomy.TryClassifySeed(pair.Key, out var seed))
            {
                rows.Add(new FuturesAssetClass(
                    pair.Key, seed.Category, seed.Sub, seed.Title, "seed", Confirmed: false));
            }
            else
            {
                toResolve.Add(pair);
            }
        }

        // Ограниченный по времени и параллелизму резолв спот-группы; сбой/таймаут кода → other.
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        budget.CancelAfter(ResolveBudget);
        using var gate = new SemaphoreSlim(ResolveConcurrency);

        var resolved = await Task.WhenAll(toResolve.Select(async pair =>
        {
            await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                var group = await catalog.ResolveAssetGroupAsync(pair.Key, budget.Token).ConfigureAwait(false);
                return new FuturesAssetClass(
                    pair.Key, FuturesAssetTaxonomy.CategoryFromIssGroup(group),
                    Subcategory: null, pair.Value, "iss_auto", Confirmed: false);
            }
            finally
            {
                gate.Release();
            }
        })).ConfigureAwait(false);

        rows.AddRange(resolved);
        var unresolved = resolved.Count(r => r.Category == FuturesAssetTaxonomy.Other);

        var inserted = await store.UpsertAutoAsync(rows, cancellationToken).ConfigureAwait(false);
        logger.LogInformation(
            "Актуализация классов фьючерсов: кодов {Total}, новых {Inserted}, не распознано {Unresolved}",
            rows.Count, inserted, unresolved);

        return new AssetClassRefreshSummary(rows.Count, inserted, unresolved);
    }
}

/// <summary>Итог актуализации справочника: всего кодов, из них новых, из них не распознано (other).</summary>
public sealed record AssetClassRefreshSummary(int Total, int Inserted, int Unresolved);
