namespace Scinverse.Ohs.Domain;

/// <summary>
/// Working set Observed: ☑ static members ∪ live recording (Auto / запись on).
/// Режет hot-cache registry и список записи (catalog-basket C2).
/// </summary>
public interface IObservedInstrumentSet
{
    /// <summary>
    /// true — кэш/список только Snapshot; false — не режем (юнит-тесты registry).
    /// </summary>
    bool RestrictsCache { get; }

    bool IsObserved(long instrumentId);

    /// <summary>Текущий снимок id (после <see cref="RebuildAsync"/>).</summary>
    IReadOnlyList<long> SnapshotIds();

    /// <summary>Observed одной connection (static ☑ ∪ recording live).</summary>
    Task<IReadOnlyList<long>> ListForConnectionAsync(long connectionId, CancellationToken cancellationToken);

    /// <summary>Union Observed по всем connections → обновить in-memory snapshot.</summary>
    Task RebuildAsync(CancellationToken cancellationToken);
}
