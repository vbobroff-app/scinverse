using FluentAssertions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Host;

namespace Scinverse.Ohs.UnitTests;

public sealed class IncidentDtoTests
{
    [Fact]
    public void ToIncidentDto_uses_closedAt_for_duration_when_resolved()
    {
        var opened = DateTimeOffset.Parse("2026-07-29T10:00:00Z");
        var closed = opened.AddSeconds(90);
        var incident = new Incident
        {
            CorrUid = "connection:1:link:x",
            Module = "connection",
            Type = "break",
            Status = "resolved",
            CloseOutcome = "recovered",
            OpenedAt = opened,
            ClosedAt = closed,
            Subject = "connection:1:link",
            Severity = "ok",
            Title = "t",
            LastActivityAt = closed,
            ConnectionId = 1,
        };

        var dto = OhsEndpoints.ToIncidentDto(incident, nowUtc: closed.AddHours(1));
        dto.DurationMs.Should().Be(90_000);
    }

    [Fact]
    public void ToIncidentDto_reads_resolvedBy_from_payload()
    {
        var opened = DateTimeOffset.Parse("2026-07-29T10:00:00Z");
        var closed = opened.AddMinutes(1);
        var incident = new Incident
        {
            CorrUid = "connection:1:link:z",
            Module = "connection",
            Type = "break",
            Status = "resolved",
            CloseOutcome = "abandoned_manual",
            OpenedAt = opened,
            ClosedAt = closed,
            Subject = "connection:1:link",
            Severity = "warning",
            Title = "t",
            LastActivityAt = closed,
            ConnectionId = 1,
            Payload = """{"resolvedBy":"superuser"}""",
        };

        var dto = OhsEndpoints.ToIncidentDto(incident, closed);
        dto.ResolvedBy.Should().Be("superuser");
    }

    [Fact]
    public void ToIncidentDto_open_uses_now_for_duration()
    {
        var opened = DateTimeOffset.Parse("2026-07-29T10:00:00Z");
        var now = opened.AddMinutes(2);
        var incident = new Incident
        {
            CorrUid = "connection:1:link:y",
            Module = "connection",
            Type = "break",
            Status = "active",
            OpenedAt = opened,
            Subject = "connection:1:link",
            Severity = "error",
            Title = "t",
            LastActivityAt = opened,
            ConnectionId = 1,
        };

        var dto = OhsEndpoints.ToIncidentDto(incident, now);
        dto.DurationMs.Should().Be(120_000);
        dto.ClosedAt.Should().BeNull();
    }
}
