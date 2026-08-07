namespace Scinverse.Ohs.Domain;

/// <summary>Порт хранилища справочника инструментов (реализация — Storage.Timescale).</summary>
public interface IInstrumentStore
{
    Task<IReadOnlyList<Instrument>> LoadAllAsync(CancellationToken cancellationToken);

    /// <summary>Загрузка инструментов по id (Observed-кэш); порядок не гарантирован.</summary>
    Task<IReadOnlyList<Instrument>> LoadByIdsAsync(
        IReadOnlyList<long> instrumentIds, CancellationToken cancellationToken);

    /// <summary>Available Online (<c>active=TRUE</c>) для eval/preview baskets — id/ticker/board/sec_type.</summary>
    Task<IReadOnlyList<AvailableInstrument>> ListAvailableAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Подписи для NC (в т.ч. архивные): <c>short_name</c> или <c>ticker</c>.
    /// </summary>
    Task<IReadOnlyDictionary<long, string>> GetDisplayLabelsAsync(
        IReadOnlyList<long> instrumentIds, CancellationToken cancellationToken);

    /// <summary>Каталог инструментов с фильтрами и пагинацией (для админки).</summary>
    Task<InstrumentCatalogPage> QueryAsync(InstrumentQuery query, CancellationToken cancellationToken);

    /// <summary>Узлы дерева каталога (группировка по базовому активу / серии).</summary>
    Task<IReadOnlyList<InstrumentGroup>> QueryGroupsAsync(GroupQuery query, CancellationToken cancellationToken);

    /// <summary>Загружает справки FUT/OPT для повторного обогащения деривативов (backfill).</summary>
    Task<IReadOnlyList<SecurityInfo>> LoadDerivativeCandidatesAsync(CancellationToken cancellationToken);

    /// <summary>Идемпотентно сохраняет market/board/instrument и возвращает инструмент со стабильным id.</summary>
    Task<Instrument> UpsertAsync(SecurityInfo security, CancellationToken cancellationToken);

    /// <summary>
    /// Пакетный upsert справочника (startup-latency #2): markets/boards + multi-row instrument
    /// + derivative. Возвращает инструменты со стабильными id (порядок не гарантирован).
    /// </summary>
    Task<IReadOnlyList<Instrument>> UpsertBatchAsync(
        IReadOnlyList<SecurityInfo> securities, CancellationToken cancellationToken);

    /// <summary>
    /// Scope-атрибуты инструмента для расписания: board, sec_type (SHARE/FUT/OPT…) и underlying_code
    /// (ASSETCODE деривативa, напр. Si). null, если инструмента нет. Используется резолвером scopeOf.
    /// </summary>
    Task<InstrumentScopeInfo?> GetScopeInfoAsync(long instrumentId, CancellationToken cancellationToken);

    /// <summary>
    /// Online-lifecycle: <c>active=TRUE</c> и не просрочен. false, если нет строки или архив.
    /// </summary>
    Task<bool> IsListedOnlineAsync(long instrumentId, CancellationToken cancellationToken);

    /// <summary>
    /// Пометить FUT/OPT с <c>derivative.expiration &lt; today</c> как <c>active=FALSE</c>.
    /// Возвращает id только что заархивированных.
    /// </summary>
    Task<IReadOnlyList<long>> ArchiveExpiredAsync(DateOnly todayMsk, CancellationToken cancellationToken);

    /// <summary>Последняя цена сделки из <c>md_trade</c> (для ATM fallback).</summary>
    Task<decimal?> GetLastTradePriceAsync(long instrumentId, CancellationToken cancellationToken);
}

/// <summary>Scope-атрибуты инструмента (для маппинга SECID → market/sec_type/category расписания).</summary>
public sealed record InstrumentScopeInfo(string Board, string? SecType, string? UnderlyingCode);
