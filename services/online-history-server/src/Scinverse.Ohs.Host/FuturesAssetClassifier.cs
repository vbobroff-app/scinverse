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

        // Уникальные коды базового актива → представитель-контракт (SECID + имя) для запроса GROUPTYPE.
        var byCode = futures
            .Where(f => !string.IsNullOrWhiteSpace(f.AssetCode) && f.SecId.Length > 0)
            .GroupBy(f => f.AssetCode!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        var rows = new List<FuturesAssetClass>(byCode.Count);
        var toResolve = new List<IssFuturesRef>();
        foreach (var (assetCode, sample) in byCode)
        {
            if (FuturesAssetTaxonomy.TryClassifySeed(assetCode, out var seed))
            {
                rows.Add(new FuturesAssetClass(
                    assetCode, seed.Category, seed.Sub, seed.Title, "seed", Confirmed: false));
            }
            else
            {
                toResolve.Add(sample);
            }
        }

        // Ограниченный по времени и параллелизму резолв «Группы контрактов» (GROUPTYPE) представителя;
        // сбой/таймаут кода → other. GROUPTYPE — авторитетный сигнал MOEX (Акции/Валюта/Индексы/…).
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        budget.CancelAfter(ResolveBudget);
        using var gate = new SemaphoreSlim(ResolveConcurrency);

        var resolved = await Task.WhenAll(toResolve.Select(async rep =>
        {
            await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                var groupType = await catalog
                    .ResolveContractGroupTypeAsync(rep.SecId, budget.Token)
                    .ConfigureAwait(false);
                return new FuturesAssetClass(
                    rep.AssetCode!, FuturesAssetTaxonomy.CategoryFromGroupType(groupType),
                    Subcategory: null, rep.ShortName, "iss_auto", Confirmed: false);
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
