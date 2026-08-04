using FluentAssertions;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

public sealed class WriteHoleBuilderTests
{
    private static readonly DateTimeOffset T0 = DateTimeOffset.Parse("2026-07-30T00:00:00Z");

    private static (DateTimeOffset From, DateTimeOffset? To) S(int fromH, int? toH) =>
        (T0.AddHours(fromH), toH is { } h ? T0.AddHours(h) : null);

    [Fact]
    public void BuildCores_Empty_when_no_overlap()
    {
        var cores = WriteHoleBuilder.BuildCores(
            1, [S(9, 18)], [S(0, 6)], T0.AddHours(20));
        cores.Should().BeEmpty();
    }

    [Fact]
    public void BuildCores_intersects_incident_and_intention()
    {
        var cores = WriteHoleBuilder.BuildCores(
            42, [S(9, 18)], [S(10, 12)], T0.AddHours(20));
        cores.Should().ContainSingle();
        var c = cores[0];
        c.InstrumentId.Should().Be(42);
        c.CoreFrom.Should().Be(T0.AddHours(10));
        c.CoreTo.Should().Be(T0.AddHours(12));
        c.IncidentOpen.Should().BeFalse();
    }

    [Fact]
    public void BuildCores_open_incident_closes_at_asOf()
    {
        var asOf = T0.AddHours(11);
        var cores = WriteHoleBuilder.BuildCores(
            1, [S(9, 18)], [S(10, null)], asOf);
        cores.Should().ContainSingle();
        cores[0].CoreTo.Should().Be(asOf);
        cores[0].IncidentOpen.Should().BeTrue();
    }

    [Fact]
    public void Expand_uses_trade_brackets()
    {
        var core = new WriteHoleBuilder.Core(
            1, T0.AddHours(10), T0.AddHours(12), T0.AddHours(9), T0.AddHours(18), false);
        var hole = WriteHoleBuilder.Expand(
            core, lastTradeBefore: T0.AddHours(9.5), firstTradeAfter: T0.AddHours(13), T0.AddHours(20));
        hole.Should().Be(new HalfOpenInterval(T0.AddHours(9.5), T0.AddHours(13)));
    }

    [Fact]
    public void Expand_falls_back_to_core_when_no_trades()
    {
        var core = new WriteHoleBuilder.Core(
            1, T0.AddHours(10), T0.AddHours(12), T0.AddHours(9), T0.AddHours(18), false);
        var hole = WriteHoleBuilder.Expand(core, null, null, T0.AddHours(20));
        hole.Should().Be(new HalfOpenInterval(T0.AddHours(10), T0.AddHours(12)));
    }

    [Fact]
    public void Expand_open_incident_prefers_first_trade_before_asOf()
    {
        var asOf = T0.AddHours(11);
        var core = new WriteHoleBuilder.Core(
            1, T0.AddHours(10), asOf, T0.AddHours(9), T0.AddHours(18), true);
        var hole = WriteHoleBuilder.Expand(
            core, T0.AddHours(9.5), firstTradeAfter: T0.AddHours(10.5), asOf);
        hole.Should().Be(new HalfOpenInterval(T0.AddHours(9.5), T0.AddHours(10.5)));
    }

    [Fact]
    public void Expand_open_incident_uses_asOf_when_no_first_trade()
    {
        var asOf = T0.AddHours(11);
        var core = new WriteHoleBuilder.Core(
            1, T0.AddHours(10), asOf, T0.AddHours(9), T0.AddHours(18), true);
        var hole = WriteHoleBuilder.Expand(core, T0.AddHours(9.5), null, asOf);
        hole.Should().Be(new HalfOpenInterval(T0.AddHours(9.5), asOf));
    }

    [Fact]
    public void Merge_overlaps_and_adjacent()
    {
        var a = new HalfOpenInterval(T0.AddHours(10), T0.AddHours(12));
        var b = new HalfOpenInterval(T0.AddHours(11), T0.AddHours(13));
        var c = new HalfOpenInterval(T0.AddHours(13), T0.AddHours(14));
        WriteHoleBuilder.Merge([b, c, a])
            .Should().Equal(new HalfOpenInterval(T0.AddHours(10), T0.AddHours(14)));
    }

    [Fact]
    public void Quiet_market_no_incident_no_cores()
    {
        WriteHoleBuilder.BuildCores(1, [S(9, 18)], [], T0.AddHours(12))
            .Should().BeEmpty();
    }

    [Fact]
    public void BuildCores_envelope_covers_incident_between_segment_pieces()
    {
        // Два сегмента; crash между ними. ∩ с envelope (9…14) — да; с каждым куском по отдельности — нет.
        var crashAt = T0.AddHours(11) + TimeSpan.FromMinutes(57) + TimeSpan.FromSeconds(36);
        var asOf = T0.AddHours(14);
        var envelope = (T0.AddHours(9), (DateTimeOffset?)asOf);
        var cores = WriteHoleBuilder.BuildCores(1, [envelope], [(crashAt, null)], asOf);
        cores.Should().ContainSingle();
        cores[0].CoreFrom.Should().Be(crashAt);
        cores[0].CoreTo.Should().Be(asOf);
    }
}
