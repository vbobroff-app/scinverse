using FluentAssertions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Host;

namespace Scinverse.Ohs.UnitTests;

public sealed class IncidentRecentBackfillTests
{
    [Fact]
    public void WindowUtc_starts_yesterday_midnight_msk()
    {
        // 2026-07-29 15:00 MSK = 12:00 UTC
        var now = new DateTimeOffset(2026, 7, 29, 12, 0, 0, TimeSpan.Zero);
        var (from, to) = IncidentRecentBackfill.WindowUtc(now);

        to.Should().Be(now);
        from.Should().Be(new DateTimeOffset(2026, 7, 28, 0, 0, 0, MoexSchedule.MoscowOffset).ToUniversalTime());
    }

    [Fact]
    public void TryMap_closed_degraded_gap_becomes_resolved_break()
    {
        var gap = new LinkGap
        {
            SourceId = 1,
            From = new DateTimeOffset(2026, 7, 28, 10, 0, 0, TimeSpan.Zero),
            To = new DateTimeOffset(2026, 7, 28, 10, 5, 0, TimeSpan.Zero),
            Cause = LinkCloseReason.Degraded,
        };
        var from = new DateTimeOffset(2026, 7, 28, 0, 0, 0, TimeSpan.Zero);
        var to = new DateTimeOffset(2026, 7, 29, 12, 0, 0, TimeSpan.Zero);

        var row = IncidentRecentBackfill.TryMap(3, gap, from, to);

        row.Should().NotBeNull();
        row!.Type.Should().Be("break");
        row.Status.Should().Be("resolved");
        row.CloseOutcome.Should().Be("recovered");
        row.Owner.Should().Be("transaq");
        row.Subtype.Should().Be("degraded");
        row.CorrUid.Should().Be(IncidentRecentBackfill.CorrUid(3, gap.From));
    }

    [Fact]
    public void TryMap_interrupted_open_gap_is_active_crash()
    {
        var gap = new LinkGap
        {
            SourceId = 1,
            From = new DateTimeOffset(2026, 7, 29, 8, 0, 0, TimeSpan.Zero),
            To = null,
            Cause = LinkCloseReason.Interrupted,
        };
        var from = new DateTimeOffset(2026, 7, 28, 0, 0, 0, TimeSpan.Zero);
        var to = new DateTimeOffset(2026, 7, 29, 12, 0, 0, TimeSpan.Zero);

        var row = IncidentRecentBackfill.TryMap(9, gap, from, to);

        row.Should().NotBeNull();
        row!.Type.Should().Be("crash");
        row.Status.Should().Be("active");
        row.CloseOutcome.Should().BeNull();
        row.Owner.Should().Be("admin");
    }

    [Fact]
    public void TryMap_skips_grey_disconnected()
    {
        var gap = new LinkGap
        {
            SourceId = 1,
            From = new DateTimeOffset(2026, 7, 28, 10, 0, 0, TimeSpan.Zero),
            To = new DateTimeOffset(2026, 7, 28, 11, 0, 0, TimeSpan.Zero),
            Cause = LinkCloseReason.Disconnected,
        };
        var from = new DateTimeOffset(2026, 7, 28, 0, 0, 0, TimeSpan.Zero);
        var to = new DateTimeOffset(2026, 7, 29, 12, 0, 0, TimeSpan.Zero);

        IncidentRecentBackfill.TryMap(1, gap, from, to).Should().BeNull();
    }

    [Fact]
    public void OverlapsExisting_detects_intersection()
    {
        var existing = new List<Incident>
        {
            new()
            {
                CorrUid = "x",
                Module = "connection",
                Type = "break",
                Status = "resolved",
                CloseOutcome = "recovered",
                OpenedAt = new DateTimeOffset(2026, 7, 28, 10, 0, 0, TimeSpan.Zero),
                ClosedAt = new DateTimeOffset(2026, 7, 28, 10, 10, 0, TimeSpan.Zero),
                Subject = "connection:1:link",
                Severity = "error",
                LastActivityAt = new DateTimeOffset(2026, 7, 28, 10, 10, 0, TimeSpan.Zero),
            },
        };
        var gap = new LinkGap
        {
            SourceId = 1,
            From = new DateTimeOffset(2026, 7, 28, 10, 5, 0, TimeSpan.Zero),
            To = new DateTimeOffset(2026, 7, 28, 10, 8, 0, TimeSpan.Zero),
            Cause = LinkCloseReason.ServerDown,
        };

        IncidentRecentBackfill.OverlapsExisting(existing, gap).Should().BeTrue();
    }

    [Fact]
    public void TryMap_abandoned_gap_uses_abandoned_schedule()
    {
        var gap = new LinkGap
        {
            SourceId = 1,
            From = new DateTimeOffset(2026, 7, 28, 10, 0, 0, TimeSpan.Zero),
            To = new DateTimeOffset(2026, 7, 28, 10, 30, 0, TimeSpan.Zero),
            Cause = LinkCloseReason.ServerDown,
            Abandoned = true,
        };
        var from = new DateTimeOffset(2026, 7, 28, 0, 0, 0, TimeSpan.Zero);
        var to = new DateTimeOffset(2026, 7, 29, 12, 0, 0, TimeSpan.Zero);

        var row = IncidentRecentBackfill.TryMap(2, gap, from, to);
        row!.CloseOutcome.Should().Be("abandoned_schedule");
        row.Status.Should().Be("resolved");
    }
}
