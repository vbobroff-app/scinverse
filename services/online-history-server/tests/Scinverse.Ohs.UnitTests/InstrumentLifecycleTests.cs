using FluentAssertions;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

public sealed class InstrumentLifecycleTests
{
    [Theory]
    [InlineData(null, true)]
    [InlineData(0, true)]   // expiration == today
    [InlineData(1, true)]   // future
    [InlineData(-1, false)] // past
    public void IsListedOnline_ByExpiration(int? dayOffset, bool expected)
    {
        var today = new DateOnly(2026, 8, 4);
        DateOnly? exp = dayOffset is null ? null : today.AddDays(dayOffset.Value);
        InstrumentLifecycle.IsListedOnline(exp, today).Should().Be(expected);
    }

    [Fact]
    public async Task FakeStore_ArchiveExpired_SetsInactiveAndReturnsIds()
    {
        var live = new Instrument
        {
            InstrumentId = 1,
            Key = new InstrumentKey("SiU6", "FUT"),
            MinStep = 1m,
            Active = true
        };
        var expired = new Instrument
        {
            InstrumentId = 2,
            Key = new InstrumentKey("SiM6", "FUT"),
            MinStep = 1m,
            Active = true
        };
        var store = new FakeInstrumentStore(live, expired);
        store.SetExpiration(1, new DateOnly(2026, 9, 17));
        store.SetExpiration(2, new DateOnly(2026, 6, 18));

        var archived = await store.ArchiveExpiredAsync(new DateOnly(2026, 8, 4), CancellationToken.None);

        archived.Should().Equal(2);
        (await store.IsListedOnlineAsync(1, CancellationToken.None)).Should().BeTrue();
        (await store.IsListedOnlineAsync(2, CancellationToken.None)).Should().BeFalse();
        (await store.LoadAllAsync(CancellationToken.None)).Should().ContainSingle(i => i.InstrumentId == 1);
    }

    [Fact]
    public async Task Registry_ObserveExpiredMiss_DoesNotCache()
    {
        var store = new FakeInstrumentStore();
        var registry = new Ingestion.InstrumentRegistry(
            store, new MoexFortsSpecParser(), new Ingestion.InstrumentCatalogPersistQueue(), TimeProvider.System);
        await registry.InitializeAsync(CancellationToken.None);

        var past = InstrumentLifecycle.TodayMoscow(TimeProvider.System).AddDays(-10);
        registry.Observe(new SecurityInfo
        {
            Key = new InstrumentKey("OLD", "FUT"),
            MinStep = 1m,
            SecType = "FUT",
            Expiration = past,
            UnderlyingCode = "Si"
        });
        await registry.FlushPendingAsync(CancellationToken.None);

        registry.TryResolve(new InstrumentKey("OLD", "FUT"), out _).Should().BeFalse();
    }
}
