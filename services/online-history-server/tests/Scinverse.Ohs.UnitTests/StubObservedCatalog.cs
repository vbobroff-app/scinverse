using Microsoft.Extensions.Logging.Abstractions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Host;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.UnitTests;

internal static class StubObservedCatalog
{
    public static ObservedCatalogCoordinator CreateCoordinator(IInstrumentRegistry registry) =>
        new(
            UnrestrictedObservedSet.Instance,
            registry,
            NullLogger<ObservedCatalogCoordinator>.Instance);

    public static InstrumentLifecycleService CreateLifecycle(
        IRecordingScheduleStore? schedule = null)
    {
        var registry = new InstrumentRegistry(
            new FakeInstrumentStore(),
            new MoexFortsSpecParser(),
            new InstrumentCatalogPersistQueue(),
            UnrestrictedObservedSet.Instance,
            TimeProvider.System);

        var hub = new NotificationHub(new WebSocketBroadcaster());
        return new InstrumentLifecycleService(
            new FakeInstrumentStore(),
            registry,
            schedule ?? new NoopSchedule(),
            new Lazy<RecordingManager>(() => throw new InvalidOperationException("unused")),
            new BasketEvalService(
                new FakeInstrumentStore(),
                new EmptyBasketStore(),
                new EmptyConnectionStoreForLifecycle(),
                NullLogger<BasketEvalService>.Instance),
            CreateCoordinator(registry),
            new CatalogRefreshNc(hub),
            new MemoryRuntimeStateStore(),
            TimeProvider.System,
            NullLogger<InstrumentLifecycleService>.Instance);
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
