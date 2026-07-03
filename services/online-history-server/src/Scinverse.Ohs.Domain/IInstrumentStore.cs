namespace Scinverse.Ohs.Domain;

/// <summary>Порт хранилища справочника инструментов (реализация — Storage.Timescale).</summary>
public interface IInstrumentStore
{
    Task<IReadOnlyList<Instrument>> LoadAllAsync(CancellationToken cancellationToken);

    /// <summary>Идемпотентно сохраняет market/board/instrument и возвращает инструмент со стабильным id.</summary>
    Task<Instrument> UpsertAsync(SecurityInfo security, CancellationToken cancellationToken);
}
