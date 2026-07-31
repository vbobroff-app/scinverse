using FluentAssertions;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

public sealed class ScheduleCutterTests
{
    private static readonly DateTimeOffset T0 = DateTimeOffset.Parse("2026-07-30T00:00:00Z");

    private static HalfOpenInterval W(int fromHour, int toHour) =>
        new(T0.AddHours(fromHour), T0.AddHours(toHour));

    private static (DateTimeOffset From, DateTimeOffset? To) G(int fromHour, int? toHour) =>
        (T0.AddHours(fromHour), toHour is { } h ? T0.AddHours(h) : null);

    [Fact]
    public void Empty_gaps_or_desired_yields_empty()
    {
        ScheduleCutter.Cut([], [W(9, 18)], T0.AddHours(12)).Should().BeEmpty();
        ScheduleCutter.Cut([G(10, 12)], [], T0.AddHours(12)).Should().BeEmpty();
        ScheduleCutter.Cut([], [], T0.AddHours(12)).Should().BeEmpty();
    }

    [Fact]
    public void Full_gap_inside_desired_unchanged()
    {
        var asOf = T0.AddHours(20);
        ScheduleCutter.Cut([G(10, 12)], [W(9, 18)], asOf)
            .Should().Equal(W(10, 12));
    }

    [Fact]
    public void Partial_clips_both_edges()
    {
        var asOf = T0.AddHours(20);
        // gap 08–20 ∩ desired 09–18 → 09–18
        ScheduleCutter.Cut([G(8, 20)], [W(9, 18)], asOf)
            .Should().Equal(W(9, 18));
    }

    [Fact]
    public void No_overlap_yields_empty()
    {
        ScheduleCutter.Cut([G(0, 6)], [W(9, 18)], T0.AddHours(20))
            .Should().BeEmpty();
    }

    [Fact]
    public void Overnight_gap_intersects_overnight_desired()
    {
        var asOf = T0.AddHours(30);
        // gap 22:00 day0 – 08:00 day1; desired 23:00 – 02:00 (хвост сессии)
        ScheduleCutter.Cut([G(22, 32)], [W(23, 26)], asOf)
            .Should().Equal(W(23, 26));
    }

    [Fact]
    public void Multi_window_splits_one_gap()
    {
        var asOf = T0.AddHours(20);
        // gap 08–19 ∩ (09–12, 14–18) → два клипа
        ScheduleCutter.Cut([G(8, 19)], [W(9, 12), W(14, 18)], asOf)
            .Should().Equal(W(9, 12), W(14, 18));
    }

    [Fact]
    public void Multi_window_result_ordered_by_from()
    {
        var asOf = T0.AddHours(20);
        // desired в обратном порядке входа — выход по From ASC
        ScheduleCutter.Cut([G(8, 19)], [W(14, 18), W(9, 12)], asOf)
            .Should().Equal(W(9, 12), W(14, 18));
    }

    [Fact]
    public void Open_gap_closes_at_asOf()
    {
        var asOf = T0.AddHours(11);
        // open gap from 10, asOf=11 ∩ desired 09–18 → [10, 11)
        ScheduleCutter.Cut([G(10, null)], [W(9, 18)], asOf)
            .Should().Equal(W(10, 11));
    }

    [Fact]
    public void Open_gap_asOf_outside_desired_clips_to_window_end()
    {
        var asOf = T0.AddHours(20);
        // open from 10, asOf=20 ∩ desired 09–18 → [10, 18)
        ScheduleCutter.Cut([G(10, null)], [W(9, 18)], asOf)
            .Should().Equal(W(10, 18));
    }

    [Fact]
    public void Degenerate_after_clip_discarded()
    {
        var asOf = T0.AddHours(12);
        // gap ends exactly at desired start → empty
        ScheduleCutter.Cut([G(8, 9)], [W(9, 18)], asOf).Should().BeEmpty();
        // from >= asOf for open gap
        ScheduleCutter.Cut([G(12, null)], [W(9, 18)], asOf).Should().BeEmpty();
        // degenerate desired
        ScheduleCutter.Cut([G(10, 12)], [new HalfOpenInterval(T0.AddHours(10), T0.AddHours(10))], asOf)
            .Should().BeEmpty();
    }
}
