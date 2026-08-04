using FluentAssertions;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

public sealed class DesiredWindowEnumeratorTests
{
    private static readonly ConnectionScheduleResolver.TradingDayLookup AlwaysTrading = (_, _) => true;
    private static readonly ConnectionScheduleResolver.TradingDayLookup NeverTrading = (_, _) => false;

    private static ConnectionScheduleRule MainWindow(string open, int durationMin) => new()
    {
        ScheduleId = 1,
        ConnectionId = 1,
        ScopeKind = ConnectionScheduleScopes.Main,
        DowMask = null,
        DateFrom = null,
        DateTo = null,
        Mode = ConnectionScheduleRuleModes.Window,
        OpenTime = TimeOnly.Parse(open),
        DurationMin = durationMin,
        EffectiveFrom = DateTimeOffset.Parse("2026-01-01T00:00:00Z"),
        EffectiveTo = null,
        ChangeSource = "test",
        ChangeNote = null,
    };

    [Fact]
    public void Empty_rules_yield_empty()
    {
        var from = DateTimeOffset.Parse("2026-07-30T00:00:00Z");
        var to = from.AddDays(1);
        DesiredWindowEnumerator.Enumerate([], "futures", "Europe/Moscow", from, to, AlwaysTrading)
            .Should().BeEmpty();
    }

    [Fact]
    public void Main_window_clipped_to_range()
    {
        // MSK 10:00–18:00 = UTC 07:00–15:00
        var rules = new[] { MainWindow("10:00", 8 * 60) };
        var from = DateTimeOffset.Parse("2026-07-30T00:00:00Z");
        var to = DateTimeOffset.Parse("2026-07-31T00:00:00Z");

        var windows = DesiredWindowEnumerator.Enumerate(
            rules, "futures", "Europe/Moscow", from, to, AlwaysTrading);

        windows.Should().ContainSingle();
        windows[0].From.Should().Be(DateTimeOffset.Parse("2026-07-30T07:00:00Z"));
        windows[0].To.Should().Be(DateTimeOffset.Parse("2026-07-30T15:00:00Z"));
    }

    [Fact]
    public void Main_gated_by_trading_day()
    {
        var rules = new[] { MainWindow("10:00", 8 * 60) };
        var from = DateTimeOffset.Parse("2026-07-30T00:00:00Z");
        var to = DateTimeOffset.Parse("2026-07-31T00:00:00Z");

        DesiredWindowEnumerator.Enumerate(
                rules, "futures", "Europe/Moscow", from, to, NeverTrading)
            .Should().BeEmpty();
    }
}
