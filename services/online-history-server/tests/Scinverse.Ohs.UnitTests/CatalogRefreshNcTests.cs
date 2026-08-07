using System.Text.Json;
using FluentAssertions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Host;

namespace Scinverse.Ohs.UnitTests;

public sealed class CatalogRefreshNcTests
{
    private static (CatalogRefreshNc Nc, NotificationHub Hub) CreateSut()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        return (new CatalogRefreshNc(hub), hub);
    }

    private static string? DataString(NotificationDto evt, string key)
    {
        if (evt.Data is not { } data || data.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return data.TryGetProperty(key, out var p) && p.ValueKind == JsonValueKind.String
            ? p.GetString()
            : null;
    }

    [Fact]
    public void PublishForceRefresh_lifecycle_stays_underway_until_post_dump()
    {
        var (nc, hub) = CreateSut();
        var sweep = new InstrumentLifecycleSweepResult(true, [11, 22]);

        var (cacheCorr, lifeCorr) = nc.PublishForceRefresh(invalidated: true, sweep);

        cacheCorr.Should().StartWith("instruments.catalog.cache:");
        lifeCorr.Should().StartWith("instruments.catalog.lifecycle:");

        var life = hub.List().Where(e => e.CorrelationId == lifeCorr).ToList();
        life.Select(e => e.Code).Should().Equal(
            "instruments.catalog.lifecycle.start",
            "instruments.catalog.lifecycle.archive",
            "instruments.catalog.lifecycle.baskets_expired",
            "instruments.catalog.lifecycle.observed",
            "instruments.catalog.lifecycle.wait_dump");
        life.Last().Status.Should().Be("underway");
        life.Single(e => e.Code.EndsWith(".archive")).Message.Should().Contain("в архив 2");

        DataString(life[0], "groupKind").Should().Be(NotificationThreadData.GroupKindLifecycle);
        DataString(hub.List().First(e => e.CorrelationId == cacheCorr), "groupKind")
            .Should().Be(NotificationThreadData.GroupKindAction);

        // Post-dump продолжает ту же lifecycle-нить.
        nc.PublishBasketSyncAfterDump().Should().Be(lifeCorr);
        var after = hub.List().Where(e => e.CorrelationId == lifeCorr).ToList();
        after.Last().Code.Should().Be("instruments.catalog.lifecycle.done");
        after.Last().Status.Should().Be("resolved");
        after.Should().Contain(e => e.Code == "instruments.catalog.lifecycle.baskets_new");
    }

    [Fact]
    public void PublishForceRefresh_when_session_live_asks_for_reconnect()
    {
        var (nc, hub) = CreateSut();
        var (cacheCorr, _) = nc.PublishForceRefresh(
            invalidated: true,
            new InstrumentLifecycleSweepResult(true, []),
            sessionLive: true);

        var wait = hub.List().Last(e => e.CorrelationId == cacheCorr);
        wait.Code.Should().Be("instruments.catalog.cache.wait_dump");
        wait.Severity.Should().Be("warning");
        wait.Message.Should().Contain("нужен reconnect");
    }

    [Fact]
    public void OnCatalogMarkedFresh_resolves_pending_cache_corr()
    {
        var (nc, hub) = CreateSut();
        var (cacheCorr, _) = nc.PublishForceRefresh(
            invalidated: true,
            new InstrumentLifecycleSweepResult(true, []));

        nc.OnCatalogMarkedFresh().Should().BeTrue();

        var last = hub.List().Last(e => e.CorrelationId == cacheCorr);
        last.Status.Should().Be("resolved");
        last.Code.Should().Be("instruments.catalog.cache.fresh");
    }

    [Fact]
    public void Second_refresh_supersedes_previous_pending_cache_and_lifecycle()
    {
        var (nc, hub) = CreateSut();
        var (firstCache, firstLife) = nc.PublishForceRefresh(
            invalidated: true,
            new InstrumentLifecycleSweepResult(true, []));
        var (secondCache, _) = nc.PublishForceRefresh(
            invalidated: true,
            new InstrumentLifecycleSweepResult(true, []));

        firstCache.Should().NotBe(secondCache);
        hub.List().Last(e => e.CorrelationId == firstCache).Code
            .Should().Be("instruments.catalog.cache.superseded");
        hub.List().Last(e => e.CorrelationId == firstLife).Code
            .Should().Be("instruments.catalog.lifecycle.superseded");
    }

    [Fact]
    public void OnCatalogMarkedFresh_without_pending_is_noop()
    {
        var (nc, hub) = CreateSut();
        nc.OnCatalogMarkedFresh().Should().BeFalse();
        hub.List().Should().BeEmpty();
    }

    [Fact]
    public void PublishDailyCheckup_continues_on_post_dump()
    {
        var (nc, hub) = CreateSut();
        var corr = nc.PublishDailyCheckup(new InstrumentLifecycleSweepResult(true, [7]));

        var mid = hub.List().Where(e => e.CorrelationId == corr).ToList();
        mid.Last().Code.Should().Be("instruments.catalog.checkup.wait_dump");
        mid.Last().Status.Should().Be("underway");
        DataString(mid[0], "groupKind").Should().Be(NotificationThreadData.GroupKindCheckup);

        nc.PublishBasketSyncAfterDump().Should().Be(corr);
        hub.List().Last(e => e.CorrelationId == corr).Code
            .Should().Be("instruments.catalog.checkup.done");
    }

    [Fact]
    public void PublishBasketSyncAfterDump_without_pending_uses_standalone_corr()
    {
        var (nc, hub) = CreateSut();
        var corr = nc.PublishBasketSyncAfterDump();

        corr.Should().StartWith("instruments.catalog.baskets:");
        hub.List().Last(e => e.CorrelationId == corr).Code
            .Should().Be("instruments.catalog.baskets.sync_done");
    }
}
