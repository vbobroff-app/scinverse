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

    [Fact]
    public void PublishForceRefresh_emits_two_independent_corrs()
    {
        var (nc, hub) = CreateSut();
        var sweep = new InstrumentLifecycleSweepResult(true, [11, 22]);

        var (cacheCorr, lifeCorr) = nc.PublishForceRefresh(invalidated: true, sweep);

        cacheCorr.Should().StartWith("instruments.catalog.cache:");
        lifeCorr.Should().StartWith("instruments.catalog.lifecycle:");
        cacheCorr.Should().NotBe(lifeCorr);

        var list = hub.List();
        list.Where(e => e.CorrelationId == cacheCorr).Should().HaveCount(4);
        list.Where(e => e.CorrelationId == lifeCorr).Should().HaveCount(2);

        list.Last(e => e.CorrelationId == cacheCorr).Status.Should().Be("underway");
        list.Last(e => e.CorrelationId == cacheCorr).Code.Should().Be("instruments.catalog.cache.wait_dump");
        list.Last(e => e.CorrelationId == cacheCorr).Message.Should().Contain("ожидание dump");

        list.Last(e => e.CorrelationId == lifeCorr).Status.Should().Be("resolved");
        list.Last(e => e.CorrelationId == lifeCorr).Message.Should().Contain("архивировано 2");
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
        wait.Message.Should().Contain("dump не повторит");
    }

    [Fact]
    public void OnCatalogMarkedFresh_resolves_pending_cache_corr()
    {
        var (nc, hub) = CreateSut();
        var (cacheCorr, _) = nc.PublishForceRefresh(
            invalidated: true,
            new InstrumentLifecycleSweepResult(true, []));

        nc.OnCatalogMarkedFresh();

        var last = hub.List().Last(e => e.CorrelationId == cacheCorr);
        last.Status.Should().Be("resolved");
        last.Code.Should().Be("instruments.catalog.cache.fresh");
        last.Severity.Should().Be("ok");
    }

    [Fact]
    public void Second_refresh_supersedes_previous_pending_cache()
    {
        var (nc, hub) = CreateSut();
        var (firstCache, _) = nc.PublishForceRefresh(
            invalidated: true,
            new InstrumentLifecycleSweepResult(true, []));
        var (secondCache, _) = nc.PublishForceRefresh(
            invalidated: true,
            new InstrumentLifecycleSweepResult(true, []));

        firstCache.Should().NotBe(secondCache);
        hub.List().Last(e => e.CorrelationId == firstCache).Code
            .Should().Be("instruments.catalog.cache.superseded");
        hub.List().Last(e => e.CorrelationId == firstCache).Status.Should().Be("resolved");
        hub.List().Last(e => e.CorrelationId == secondCache).Status.Should().Be("underway");
    }

    [Fact]
    public void OnCatalogMarkedFresh_without_pending_is_noop()
    {
        var (nc, hub) = CreateSut();
        nc.OnCatalogMarkedFresh();
        hub.List().Should().BeEmpty();
    }
}
