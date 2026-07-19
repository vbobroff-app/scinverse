using FluentAssertions;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

public sealed class ConnectionScheduleResolverTests
{
    private static readonly DateOnly Saturday = new(2026, 7, 18);
    private static readonly DateOnly Sunday = new(2026, 7, 19);
    private static readonly DateOnly Friday = new(2026, 7, 17);

    private static ConnectionScheduleRule Rule(
        string scope,
        string mode,
        TimeOnly? open = null,
        int? dur = null,
        int? mask = null,
        DateOnly? from = null,
        DateOnly? to = null,
        DateTimeOffset? effectiveFrom = null) => new()
    {
        ScheduleId = 0,
        ConnectionId = 1,
        ScopeKind = scope,
        DowMask = mask,
        DateFrom = from,
        DateTo = to,
        Mode = mode,
        OpenTime = open,
        DurationMin = dur,
        EffectiveFrom = effectiveFrom ?? DateTimeOffset.UnixEpoch,
        ChangeSource = "test",
    };

    private static ConnectionScheduleResolver.TradingDayLookup AlwaysTrading => (_, _) => true;

    [Fact]
    public void Main_window_connected_inside_and_disconnected_outside()
    {
        var rules = new[] { Rule("main", "window", new TimeOnly(9, 0), 540) }; // 09:00–18:00

        ConnectionScheduleResolver
            .IsConnectDesired(rules, "futures", Saturday, new TimeOnly(10, 0), AlwaysTrading)
            .Should().BeTrue();
        ConnectionScheduleResolver
            .IsConnectDesired(rules, "futures", Saturday, new TimeOnly(18, 0), AlwaysTrading)
            .Should().BeFalse();
    }

    [Fact]
    public void Main_not_connected_on_non_trading_day()
    {
        var rules = new[] { Rule("main", "window", new TimeOnly(9, 0), 540) };

        ConnectionScheduleResolver
            .IsConnectDesired(rules, "futures", Saturday, new TimeOnly(10, 0), (_, _) => false)
            .Should().BeFalse();
    }

    [Fact]
    public void Dow_exception_overrides_main_even_when_main_is_newer()
    {
        var mainNewer = Rule("main", "window", new TimeOnly(7, 0), 600, effectiveFrom: DateTimeOffset.UnixEpoch.AddYears(3));
        var dowOlder = Rule("dow", "window", new TimeOnly(12, 0), 120, mask: ConnectionScheduleDow.Weekend, effectiveFrom: DateTimeOffset.UnixEpoch);
        var rules = new[] { mainNewer, dowOlder };

        // В субботу (выходной по dow) должно действовать dow-правило 12:00–14:00, не main.
        ConnectionScheduleResolver
            .IsConnectDesired(rules, "futures", Saturday, new TimeOnly(13, 0), AlwaysTrading)
            .Should().BeTrue();
        ConnectionScheduleResolver
            .IsConnectDesired(rules, "futures", Saturday, new TimeOnly(8, 0), AlwaysTrading)
            .Should().BeFalse();
    }

    [Fact]
    public void Date_exception_overrides_dow()
    {
        var dow = Rule("dow", "window", new TimeOnly(10, 0), 540, mask: ConnectionScheduleDow.Weekend);
        var date = Rule("date", "off", from: Saturday, to: Saturday, effectiveFrom: DateTimeOffset.UnixEpoch.AddDays(-100));
        var rules = new[] { dow, date };

        // date-off на субботу побеждает dow, несмотря на то что старше.
        ConnectionScheduleResolver
            .IsConnectDesired(rules, "futures", Saturday, new TimeOnly(11, 0), AlwaysTrading)
            .Should().BeFalse();
    }

    [Fact]
    public void Recency_wins_within_same_tier()
    {
        var weekend = Rule("dow", "window", new TimeOnly(10, 0), 540, mask: ConnectionScheduleDow.Weekend, effectiveFrom: DateTimeOffset.UnixEpoch);
        var satNewer = Rule("dow", "window", new TimeOnly(14, 0), 300, mask: ConnectionScheduleDow.Bit(DayOfWeek.Saturday), effectiveFrom: DateTimeOffset.UnixEpoch.AddDays(10));
        var rules = new[] { weekend, satNewer };

        // Суббота: свежее субботнее правило 14:00–19:00 бьёт «выходные».
        ConnectionScheduleResolver
            .IsConnectDesired(rules, "futures", Saturday, new TimeOnly(11, 0), AlwaysTrading)
            .Should().BeFalse();
        ConnectionScheduleResolver
            .IsConnectDesired(rules, "futures", Saturday, new TimeOnly(15, 0), AlwaysTrading)
            .Should().BeTrue();
        // Воскресенье: субботнее не покрывает → действует «выходные».
        ConnectionScheduleResolver
            .IsConnectDesired(rules, "futures", Sunday, new TimeOnly(11, 0), AlwaysTrading)
            .Should().BeTrue();
    }

    [Fact]
    public void Overnight_tail_belongs_to_open_day()
    {
        // Пятничная сессия 22:00 + 4ч = до 02:00 субботы; принадлежит пятнице.
        var friday = Rule("dow", "window", new TimeOnly(22, 0), 240, mask: ConnectionScheduleDow.Bit(DayOfWeek.Friday));
        var rules = new[] { friday };

        // Суббота 00:30 — внутри пятничного хвоста.
        ConnectionScheduleResolver
            .IsConnectDesired(rules, "futures", Saturday, new TimeOnly(0, 30), AlwaysTrading)
            .Should().BeTrue();
        // Суббота 03:00 — уже вне.
        ConnectionScheduleResolver
            .IsConnectDesired(rules, "futures", Saturday, new TimeOnly(3, 0), AlwaysTrading)
            .Should().BeFalse();
    }

    [Fact]
    public void Off_mode_means_no_session()
    {
        var rules = new[] { Rule("main", "off") };

        ConnectionScheduleResolver
            .IsConnectDesired(rules, "futures", Saturday, new TimeOnly(12, 0), AlwaysTrading)
            .Should().BeFalse();
    }

    [Fact]
    public void No_rules_means_not_connected()
    {
        ConnectionScheduleResolver
            .IsConnectDesired(Array.Empty<ConnectionScheduleRule>(), "futures", Saturday, new TimeOnly(12, 0), AlwaysTrading)
            .Should().BeFalse();
    }

    [Fact]
    public void Friday_belongs_to_friday_not_affected_by_saturday_off()
    {
        // Пятничный хвост в субботу НЕ отменяется субботним date-off.
        var friday = Rule("dow", "window", new TimeOnly(22, 0), 240, mask: ConnectionScheduleDow.Bit(DayOfWeek.Friday));
        var satOff = Rule("date", "off", from: Saturday, to: Saturday);
        var rules = new[] { friday, satOff };

        ConnectionScheduleResolver
            .IsConnectDesired(rules, "futures", Saturday, new TimeOnly(0, 30), AlwaysTrading)
            .Should().BeTrue();
    }
}
