using FluentAssertions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.UnitTests;

public sealed class ObservedCacheTests
{
    private static readonly InstrumentKey Sber = new("SBER", "TQBR");
    private static readonly InstrumentKey Gazp = new("GAZP", "TQBR");

    private sealed class FixedObservedSet(params long[] ids) : IObservedInstrumentSet
    {
        private readonly HashSet<long> _ids = [.. ids];

        public bool RestrictsCache => true;

        public bool IsObserved(long instrumentId) => _ids.Contains(instrumentId);

        public IReadOnlyList<long> SnapshotIds() => _ids.OrderBy(x => x).ToList();

        public Task<IReadOnlyList<long>> ListForConnectionAsync(
            long connectionId, CancellationToken cancellationToken) =>
            Task.FromResult(SnapshotIds());

        public Task RebuildAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }

    [Fact]
    public async Task Initialize_loads_only_observed_ids()
    {
        var store = new FakeInstrumentStore(
            new Instrument { InstrumentId = 1, Key = Sber, MinStep = 0.01m },
            new Instrument { InstrumentId = 2, Key = Gazp, MinStep = 0.01m });

        var registry = new InstrumentRegistry(
            store,
            new MoexFortsSpecParser(),
            new InstrumentCatalogPersistQueue(),
            new FixedObservedSet(1),
            TimeProvider.System);

        await registry.InitializeAsync(CancellationToken.None);

        registry.TryResolve(Sber, out _).Should().BeTrue();
        registry.TryResolve(Gazp, out _).Should().BeFalse();
    }

    [Fact]
    public async Task ApplyPersisted_skips_non_observed()
    {
        var store = new FakeInstrumentStore();
        var registry = new InstrumentRegistry(
            store,
            new MoexFortsSpecParser(),
            new InstrumentCatalogPersistQueue(),
            new FixedObservedSet(1),
            TimeProvider.System);

        await registry.InitializeAsync(CancellationToken.None);

        registry.ApplyPersisted(
        [
            new Instrument { InstrumentId = 1, Key = Sber, MinStep = 0.01m, Active = true },
            new Instrument { InstrumentId = 2, Key = Gazp, MinStep = 0.01m, Active = true },
        ]);

        registry.TryResolve(Sber, out _).Should().BeTrue();
        registry.TryResolve(Gazp, out _).Should().BeFalse();
    }
}
