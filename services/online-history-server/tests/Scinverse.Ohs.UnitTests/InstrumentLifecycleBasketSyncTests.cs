using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Host;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.UnitTests;

public sealed class InstrumentLifecycleBasketSyncTests
{
    private static InstrumentLifecycleService CreateSut(
        out NotificationHub hub,
        out FakeInstrumentStore store,
        out TrackingBasketStore baskets,
        IRuntimeStateStore? runtime = null)
    {
        hub = new NotificationHub(new WebSocketBroadcaster());
        store = new FakeInstrumentStore();
        baskets = new TrackingBasketStore();
        var registry = new InstrumentRegistry(
            store,
            new MoexFortsSpecParser(),
            new InstrumentCatalogPersistQueue(),
            UnrestrictedObservedSet.Instance,
            TimeProvider.System);
        var eval = new BasketEvalService(
            store,
            baskets,
            new SingleConnectionStore(42),
            NullLogger<BasketEvalService>.Instance);

        return new InstrumentLifecycleService(
            store,
            registry,
            new NoopSchedule(),
            new Lazy<RecordingManager>(() => throw new InvalidOperationException("unused")),
            eval,
            StubObservedCatalog.CreateCoordinator(registry),
            new CatalogRefreshNc(hub),
            runtime ?? new MemoryRuntimeStateStore(),
            TimeProvider.System,
            NullLogger<InstrumentLifecycleService>.Instance);
    }

    [Fact]
    public async Task TrySyncBasketsAfterDump_runs_once_per_day_unless_force()
    {
        var sut = CreateSut(out var hub, out _, out var baskets);

        (await sut.TrySyncBasketsAfterDumpAsync(force: false, CancellationToken.None)).Should().BeTrue();
        baskets.ReEvalCalls.Should().Be(1);
        // Без предшествующего sweep — отдельная baskets-нить (Checkup: разовая сверка).
        hub.List().Should().Contain(e => e.Code == "instruments.catalog.baskets.sync_done");

        (await sut.TrySyncBasketsAfterDumpAsync(force: false, CancellationToken.None)).Should().BeFalse();
        baskets.ReEvalCalls.Should().Be(1);

        (await sut.TrySyncBasketsAfterDumpAsync(force: true, CancellationToken.None)).Should().BeTrue();
        baskets.ReEvalCalls.Should().Be(2);
    }

    [Fact]
    public async Task TrySweep_auto_publishes_checkup_and_reevals_baskets()
    {
        var expired = new Instrument
        {
            InstrumentId = 1,
            Key = new InstrumentKey("SiM6", "FUT"),
            MinStep = 1m,
            Active = true,
        };
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var store = new FakeInstrumentStore(expired);
        store.SetExpiration(1, InstrumentLifecycle.TodayMoscow(TimeProvider.System).AddDays(-1));
        var baskets = new TrackingBasketStore();
        var registry = new InstrumentRegistry(
            store,
            new MoexFortsSpecParser(),
            new InstrumentCatalogPersistQueue(),
            UnrestrictedObservedSet.Instance,
            TimeProvider.System);
        var sut = new InstrumentLifecycleService(
            store,
            registry,
            new NoopSchedule(),
            new Lazy<RecordingManager>(() => throw new InvalidOperationException("unused")),
            new BasketEvalService(
                store,
                baskets,
                new SingleConnectionStore(42),
                NullLogger<BasketEvalService>.Instance),
            StubObservedCatalog.CreateCoordinator(registry),
            new CatalogRefreshNc(hub),
            new MemoryRuntimeStateStore(),
            TimeProvider.System,
            NullLogger<InstrumentLifecycleService>.Instance);

        var result = await sut.TrySweepAsync(force: false, CancellationToken.None);

        result.Ran.Should().BeTrue();
        result.ArchivedInstrumentIds.Should().Equal(1);
        baskets.ReEvalCalls.Should().Be(1);
        hub.List().Should().Contain(e => e.Code == "instruments.catalog.lifecycle.wait_dump");
        hub.List().Should().Contain(e => e.Code == "instruments.catalog.lifecycle.baskets_expired");
        hub.List().Should().NotContain(e => e.Code == "instruments.catalog.lifecycle.done");

        (await sut.TrySyncBasketsAfterDumpAsync(force: true, CancellationToken.None)).Should().BeTrue();
        hub.List().Should().Contain(e => e.Code == "instruments.catalog.lifecycle.done");
    }

    [Fact]
    public async Task TrySweep_skips_after_restart_when_checkup_day_persisted()
    {
        var runtime = new MemoryRuntimeStateStore();
        var first = CreateSut(out var hub1, out _, out _, runtime);

        (await first.TrySweepAsync(force: false, CancellationToken.None)).Ran.Should().BeTrue();
        hub1.List().Should().Contain(e => e.Code == "instruments.catalog.lifecycle.wait_dump");

        // Новый экземпляр Host — in-memory гейт пуст, но checkpoint в store уже есть.
        var second = CreateSut(out var hub2, out _, out _, runtime);
        (await second.TrySweepAsync(force: false, CancellationToken.None)).Ran.Should().BeFalse();
        hub2.List().Should().BeEmpty();
    }

    internal sealed class TrackingBasketStore : IBasketStore
    {
        public int ReEvalCalls { get; private set; }

        public Task EnsureSystemBasketsAsync(long connectionId, CancellationToken cancellationToken)
        {
            ReEvalCalls++;
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<InstrumentBasket>> ListAsync(
            long connectionId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<InstrumentBasket>>([]);

        public Task<InstrumentBasket?> GetAsync(long basketId, CancellationToken cancellationToken) =>
            Task.FromResult<InstrumentBasket?>(null);

        public Task<InstrumentBasket> CreateStaticAsync(
            long connectionId, string name, BasketRule rule, bool enabled, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<InstrumentBasket> UpdateStaticAsync(
            long basketId, string name, BasketRule rule, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<InstrumentBasket> SetEnabledAsync(
            long basketId, bool enabled, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task DeleteAsync(long basketId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task ReplaceMembersAsync(
            long basketId, IReadOnlyList<long> instrumentIds, CancellationToken cancellationToken) =>
            Task.CompletedTask;

        public Task<IReadOnlyList<long>> ListMemberIdsAsync(
            long basketId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<long>>([]);

        public Task<IReadOnlyList<long>> ListEnabledStaticMemberIdsAsync(
            long connectionId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<long>>([]);
    }

    private sealed class SingleConnectionStore : IConnectionStore
    {
        private readonly long _id;

        public SingleConnectionStore(long id) => _id = id;

        public Task<IReadOnlyList<ConnectorConnection>> ListAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<ConnectorConnection>>([
                new ConnectorConnection
                {
                    ConnectionId = _id,
                    SourceId = 1,
                    Name = "t",
                    Kind = "synthetic",
                    Settings = "{}",
                    Enabled = true,
                },
            ]);

        public Task<ConnectorConnection?> GetAsync(long connectionId, CancellationToken cancellationToken) =>
            Task.FromResult<ConnectorConnection?>(null);

        public Task<ConnectorConnection> UpsertAsync(
            short sourceId, string name, string kind, string settings, bool enabled,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<ConnectorConnection?> UpdateAsync(
            long connectionId, short sourceId, string name, string kind, string settings, bool enabled,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<bool> DeleteAsync(long connectionId, CancellationToken cancellationToken) =>
            Task.FromResult(false);

        public Task SetEnabledAsync(long connectionId, bool enabled, CancellationToken cancellationToken) =>
            Task.CompletedTask;
    }

    private sealed class NoopSchedule : IRecordingScheduleStore
    {
        public Task<IReadOnlyList<RecordingScheduleEntry>> ListAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<RecordingScheduleEntry>>([]);

        public Task<IReadOnlyList<RecordingScheduleEntry>> ListEnabledAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<RecordingScheduleEntry>>([]);

        public Task<IReadOnlyList<RecordingScheduleEntry>> UpsertAsync(
            IReadOnlyList<RecordingScheduleEntry> entries, CancellationToken cancellationToken) =>
            Task.FromResult(entries);

        public Task DisableAutoAsync(long instrumentId, CancellationToken cancellationToken) =>
            Task.CompletedTask;

        public Task DisableAutoManyAsync(IReadOnlyList<long> instrumentIds, CancellationToken cancellationToken) =>
            Task.CompletedTask;
    }
}
