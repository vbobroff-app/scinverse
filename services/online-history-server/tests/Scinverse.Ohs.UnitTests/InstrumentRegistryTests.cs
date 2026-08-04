using FluentAssertions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.UnitTests;

public sealed class InstrumentRegistryTests
{
    private static readonly InstrumentKey Sber = new("SBER", "TQBR");
    private static readonly InstrumentKey Gazp = new("GAZP", "TQBR");

    private static InstrumentRegistry CreateRegistry(params Instrument[] seed)
    {
        return new InstrumentRegistry(
            new FakeInstrumentStore(seed),
            new MoexFortsSpecParser(),
            new InstrumentCatalogPersistQueue(),
            TimeProvider.System);
    }

    private static SecurityInfo Sec(InstrumentKey key, decimal minStep = 0.01m) => new()
    {
        Key = key,
        MinStep = minStep,
        Decimals = 2,
        SecType = "SHARE",
        MarketId = 1
    };

    [Fact]
    public async Task Observe_FreshCacheHit_DoesNotTouchStore()
    {
        var store = new CountingInstrumentStore(new Instrument
        {
            InstrumentId = 1,
            Key = Sber,
            MinStep = 0.01m,
            Decimals = 2
        });
        var registry = new InstrumentRegistry(
            store, new MoexFortsSpecParser(), new InstrumentCatalogPersistQueue(), TimeProvider.System);
        await registry.InitializeAsync(CancellationToken.None);

        registry.Observe(Sec(Sber, minStep: 0.05m));
        await registry.FlushPendingAsync(CancellationToken.None);

        store.UpsertCalls.Should().Be(0);
        store.BatchCalls.Should().Be(0);
        registry.TryResolve(Sber, out var instrument).Should().BeTrue();
        instrument!.MinStep.Should().Be(0.01m); // кэш не трогали
        registry.IsFresh.Should().BeTrue();
    }

    [Fact]
    public async Task Observe_StaleCacheHit_EnqueuesPersist_KeepsId()
    {
        var queue = new InstrumentCatalogPersistQueue();
        var store = new CountingInstrumentStore(new Instrument
        {
            InstrumentId = 7,
            Key = Sber,
            MinStep = 0.01m
        });
        var registry = new InstrumentRegistry(
            store, new MoexFortsSpecParser(), queue, TimeProvider.System);
        await registry.InitializeAsync(CancellationToken.None);

        registry.Invalidate(force: true).Should().BeTrue();
        registry.IsFresh.Should().BeFalse();

        registry.Observe(Sec(Sber, minStep: 0.05m));
        await registry.FlushPendingAsync(CancellationToken.None);

        store.BatchCalls.Should().Be(0); // hit → очередь, не miss-flush
        queue.ApproxCount.Should().Be(1);
        registry.TryResolve(Sber, out var instrument).Should().BeTrue();
        instrument!.InstrumentId.Should().Be(7);
        instrument.MinStep.Should().Be(0.05m);
    }

    [Fact]
    public async Task Observe_Miss_FlushesBatchIntoStore()
    {
        var store = new CountingInstrumentStore();
        var registry = new InstrumentRegistry(
            store, new MoexFortsSpecParser(), new InstrumentCatalogPersistQueue(), TimeProvider.System);
        await registry.InitializeAsync(CancellationToken.None);

        registry.Observe(Sec(Sber));
        registry.Observe(Sec(Gazp));
        await registry.FlushPendingAsync(CancellationToken.None);

        store.BatchCalls.Should().Be(1);
        registry.TryResolve(Sber, out var sber).Should().BeTrue();
        registry.TryResolve(Gazp, out var gazp).Should().BeTrue();
        sber!.InstrumentId.Should().NotBe(gazp!.InstrumentId);
    }

    [Fact]
    public async Task Invalidate_DailyGate_BlocksSecondCallSameDay()
    {
        var registry = CreateRegistry();
        await registry.InitializeAsync(CancellationToken.None);

        registry.Invalidate(force: false).Should().BeTrue();
        registry.Invalidate(force: false).Should().BeFalse();
        registry.Invalidate(force: true).Should().BeTrue();
    }

    [Fact]
    public async Task MarkFresh_AfterInvalidate_SkipsPersistOnHit()
    {
        var queue = new InstrumentCatalogPersistQueue();
        var store = new CountingInstrumentStore(new Instrument
        {
            InstrumentId = 1,
            Key = Sber,
            MinStep = 0.01m
        });
        var registry = new InstrumentRegistry(
            store, new MoexFortsSpecParser(), queue, TimeProvider.System);
        await registry.InitializeAsync(CancellationToken.None);

        registry.Invalidate(force: true);
        registry.MarkFresh();
        registry.Observe(Sec(Sber));

        queue.ApproxCount.Should().Be(0);
        store.BatchCalls.Should().Be(0);
    }

    /// <summary>Счётчик вызовов upsert для проверки «не писали в БД».</summary>
    private sealed class CountingInstrumentStore : IInstrumentStore
    {
        private readonly FakeInstrumentStore _inner;
        public int UpsertCalls { get; private set; }
        public int BatchCalls { get; private set; }

        public CountingInstrumentStore(params Instrument[] seed) => _inner = new FakeInstrumentStore(seed);

        public Task<IReadOnlyList<Instrument>> LoadAllAsync(CancellationToken cancellationToken) =>
            _inner.LoadAllAsync(cancellationToken);

        public Task<InstrumentCatalogPage> QueryAsync(InstrumentQuery query, CancellationToken cancellationToken) =>
            _inner.QueryAsync(query, cancellationToken);

        public Task<IReadOnlyList<InstrumentGroup>> QueryGroupsAsync(
            GroupQuery query, CancellationToken cancellationToken) =>
            _inner.QueryGroupsAsync(query, cancellationToken);

        public Task<IReadOnlyList<SecurityInfo>> LoadDerivativeCandidatesAsync(CancellationToken cancellationToken) =>
            _inner.LoadDerivativeCandidatesAsync(cancellationToken);

        public Task<Instrument> UpsertAsync(SecurityInfo security, CancellationToken cancellationToken)
        {
            UpsertCalls++;
            return _inner.UpsertAsync(security, cancellationToken);
        }

        public Task<IReadOnlyList<Instrument>> UpsertBatchAsync(
            IReadOnlyList<SecurityInfo> securities, CancellationToken cancellationToken)
        {
            BatchCalls++;
            return _inner.UpsertBatchAsync(securities, cancellationToken);
        }

        public Task<InstrumentScopeInfo?> GetScopeInfoAsync(
            long instrumentId, CancellationToken cancellationToken) =>
            _inner.GetScopeInfoAsync(instrumentId, cancellationToken);

        public Task<bool> IsListedOnlineAsync(long instrumentId, CancellationToken cancellationToken) =>
            _inner.IsListedOnlineAsync(instrumentId, cancellationToken);

        public Task<IReadOnlyList<long>> ArchiveExpiredAsync(
            DateOnly todayMsk, CancellationToken cancellationToken) =>
            _inner.ArchiveExpiredAsync(todayMsk, cancellationToken);

        public Task<decimal?> GetLastTradePriceAsync(long instrumentId, CancellationToken cancellationToken) =>
            _inner.GetLastTradePriceAsync(instrumentId, cancellationToken);
    }
}
