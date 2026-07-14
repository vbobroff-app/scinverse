namespace Scinverse.Ohs.Domain;

/// <summary>Порт хранилища справочника инструментов (реализация — Storage.Timescale).</summary>
public interface IInstrumentStore
{
    Task<IReadOnlyList<Instrument>> LoadAllAsync(CancellationToken cancellationToken);

    /// <summary>Каталог инструментов с фильтрами и пагинацией (для админки).</summary>
    Task<InstrumentCatalogPage> QueryAsync(InstrumentQuery query, CancellationToken cancellationToken);

    /// <summary>Узлы дерева каталога (группировка по базовому активу / серии).</summary>
    Task<IReadOnlyList<InstrumentGroup>> QueryGroupsAsync(GroupQuery query, CancellationToken cancellationToken);

    /// <summary>Загружает справки FUT/OPT для повторного обогащения деривативов (backfill).</summary>
    Task<IReadOnlyList<SecurityInfo>> LoadDerivativeCandidatesAsync(CancellationToken cancellationToken);

    /// <summary>Идемпотентно сохраняет market/board/instrument и возвращает инструмент со стабильным id.</summary>
    Task<Instrument> UpsertAsync(SecurityInfo security, CancellationToken cancellationToken);

    /// <summary>
    /// Scope-атрибуты инструмента для расписания: board, sec_type (SHARE/FUT/OPT…) и underlying_code
    /// (ASSETCODE деривативa, напр. Si). null, если инструмента нет. Используется резолвером scopeOf.
    /// </summary>
    Task<InstrumentScopeInfo?> GetScopeInfoAsync(long instrumentId, CancellationToken cancellationToken);
}

/// <summary>Scope-атрибуты инструмента (для маппинга SECID → market/sec_type/category расписания).</summary>
public sealed record InstrumentScopeInfo(string Board, string? SecType, string? UnderlyingCode);
