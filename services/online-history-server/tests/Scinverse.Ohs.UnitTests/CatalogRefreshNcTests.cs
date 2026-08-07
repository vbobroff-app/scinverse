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
    public void PublishForceRefresh_checkup_stays_underway_until_post_dump()
    {
        var (nc, hub) = CreateSut();
        var sweep = new InstrumentLifecycleSweepResult(true, [11, 22]);

        var (cacheCorr, checkupCorr) = nc.PublishForceRefresh(invalidated: true, sweep);

        cacheCorr.Should().StartWith("instruments.catalog.cache:");
        checkupCorr.Should().StartWith("instruments.catalog.checkup:");

        var checkup = hub.List().Where(e => e.CorrelationId == checkupCorr).ToList();
        checkup.Select(e => e.Code).Should().Equal(
            "instruments.catalog.checkup.start",
            "instruments.catalog.checkup.archive",
            "instruments.catalog.checkup.baskets_expired",
            "instruments.catalog.checkup.observed",
            "instruments.catalog.checkup.wait_dump");
        checkup.Last().Status.Should().Be("underway");
        checkup.Single(e => e.Code.EndsWith(".archive")).Message.Should().Contain("в архив 2");

        DataString(checkup[0], "groupKind").Should().Be(NotificationThreadData.GroupKindCheckup);
        DataString(hub.List().First(e => e.CorrelationId == cacheCorr), "groupKind")
            .Should().Be(NotificationThreadData.GroupKindAction);

        // Post-dump продолжает ту же checkup-нить.
        var added = new[]
        {
            new BasketMemberChange(1, "Si", 99, "Si-12.26"),
        };
        nc.PublishBasketSyncAfterDump(added).Should().Be(checkupCorr);
        var after = hub.List().Where(e => e.CorrelationId == checkupCorr).ToList();
        after.Last().Code.Should().Be("instruments.catalog.checkup.done");
        after.Last().Status.Should().Be("resolved");
        var basketsNew = after.Single(e => e.Code == "instruments.catalog.checkup.baskets_new");
        basketsNew.Message.Should().Contain("добавлено (1)");
        basketsNew.Data!.Value.GetProperty("count").GetInt32().Should().Be(1);
        basketsNew.Data!.Value.GetProperty("items")[0].GetProperty("label").GetString()
            .Should().Be("Si-12.26");
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
    public void Second_refresh_supersedes_previous_pending_cache_and_checkup()
    {
        var (nc, hub) = CreateSut();
        var (firstCache, firstCheckup) = nc.PublishForceRefresh(
            invalidated: true,
            new InstrumentLifecycleSweepResult(true, []));
        var (secondCache, _) = nc.PublishForceRefresh(
            invalidated: true,
            new InstrumentLifecycleSweepResult(true, []));

        firstCache.Should().NotBe(secondCache);
        hub.List().Last(e => e.CorrelationId == firstCache).Code
            .Should().Be("instruments.catalog.cache.superseded");
        hub.List().Last(e => e.CorrelationId == firstCheckup).Code
            .Should().Be("instruments.catalog.checkup.superseded");
    }

    [Fact]
    public void OnCatalogMarkedFresh_without_pending_is_noop()
    {
        var (nc, hub) = CreateSut();
        nc.OnCatalogMarkedFresh().Should().BeFalse();
        hub.List().Should().BeEmpty();
    }

    [Fact]
    public void PublishDailyLifecycle_continues_on_post_dump()
    {
        var (nc, hub) = CreateSut();
        var corr = nc.PublishDailyLifecycle(new InstrumentLifecycleSweepResult(true, [7]));

        var mid = hub.List().Where(e => e.CorrelationId == corr).ToList();
        mid.Last().Code.Should().Be("instruments.catalog.lifecycle.wait_dump");
        mid.Last().Status.Should().Be("underway");
        DataString(mid[0], "groupKind").Should().Be(NotificationThreadData.GroupKindLifecycle);

        nc.PublishBasketSyncAfterDump([]).Should().Be(corr);
        hub.List().Last(e => e.CorrelationId == corr).Code
            .Should().Be("instruments.catalog.lifecycle.done");
    }

    [Fact]
    public void PublishDailyLifecycle_baskets_expired_includes_count_and_details()
    {
        var (nc, hub) = CreateSut();
        var sweep = new InstrumentLifecycleSweepResult(
            true,
            [11],
            [
                new BasketMemberChange(5, "Currency", 11, "Si-6.26"),
                new BasketMemberChange(5, "Currency", 12, "Si-9.26"),
            ]);

        var corr = nc.PublishDailyLifecycle(sweep);
        var expired = hub.List().Single(e =>
            e.CorrelationId == corr && e.Code == "instruments.catalog.lifecycle.baskets_expired");

        expired.Message.Should().Be("Суточная актуализация каталога: из наборов убрано (2) просроченных");
        expired.Data!.Value.GetProperty("count").GetInt32().Should().Be(2);
        expired.Data!.Value.GetProperty("items")[0].GetProperty("basket").GetString()
            .Should().Be("Currency");
        expired.Data!.Value.GetProperty("items")[0].GetProperty("label").GetString()
            .Should().Be("Si-6.26");
    }

    [Fact]
    public void PublishBasketSyncAfterDump_without_pending_uses_standalone_corr()
    {
        var (nc, hub) = CreateSut();
        var corr = nc.PublishBasketSyncAfterDump([]);

        corr.Should().StartWith("instruments.catalog.baskets:");
        hub.List().Last(e => e.CorrelationId == corr).Code
            .Should().Be("instruments.catalog.baskets.sync_done");
        hub.List().Should().Contain(e =>
            e.CorrelationId == corr
            && e.Message.Contains("добавлено (0)", StringComparison.Ordinal));
        DataString(hub.List().First(e => e.CorrelationId == corr), "groupKind")
            .Should().Be(NotificationThreadData.GroupKindCheckup);
    }
}
