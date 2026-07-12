namespace Scinverse.Ohs.Domain;

/// <summary>
/// Курируемый справочник классов базового актива фьючерсов (futures_asset_class):
/// asset_code → категория. Наполняется из ISS по кнопке; ручное курирование не перезатирается.
/// </summary>
public interface IFuturesAssetClassStore
{
    /// <summary>Все записи справочника (по asset_code).</summary>
    Task<IReadOnlyList<FuturesAssetClass>> ListAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Upsert набора авто-классифицированных записей. Строки с <see cref="FuturesAssetClass.Confirmed"/>=true
    /// (ручное курирование) НЕ перезатираются: обновляются лишь категория/подкатегория/имя незакреплённых.
    /// Возвращает число вставленных (новых) asset_code.
    /// </summary>
    Task<int> UpsertAutoAsync(IReadOnlyList<FuturesAssetClass> rows, CancellationToken cancellationToken);
}

/// <summary>Запись справочника классов базового актива фьючерса.</summary>
/// <param name="AssetCode">ASSETCODE из ISS (Si, SBER, BR, IMOEX…).</param>
/// <param name="Category">index|shares|currency|rate|commodity|other.</param>
/// <param name="Subcategory">Уточнение (oil|metals|agro…), опционально.</param>
/// <param name="Title">Человекочитаемое имя базового актива.</param>
/// <param name="Source">seed|iss_auto|curated — источник классификации.</param>
/// <param name="Confirmed">Прошло ручную проверку (курирование).</param>
public sealed record FuturesAssetClass(
    string AssetCode,
    string Category,
    string? Subcategory,
    string? Title,
    string Source,
    bool Confirmed);
