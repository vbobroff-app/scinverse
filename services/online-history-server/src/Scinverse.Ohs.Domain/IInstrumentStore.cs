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
}
