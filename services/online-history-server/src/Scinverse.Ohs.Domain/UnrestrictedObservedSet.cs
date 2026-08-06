namespace Scinverse.Ohs.Domain;

/// <summary>Observed не режет кэш (тесты InstrumentRegistry / legacy init).</summary>
public sealed class UnrestrictedObservedSet : IObservedInstrumentSet
{
    public static UnrestrictedObservedSet Instance { get; } = new();

    public bool RestrictsCache => false;

    public bool IsObserved(long instrumentId) => true;

    public IReadOnlyList<long> SnapshotIds() => [];

    public Task<IReadOnlyList<long>> ListForConnectionAsync(
        long connectionId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<long>>([]);

    public Task RebuildAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
