using FluentAssertions;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

public sealed class ConnectionScheduleWindowTests
{
    [Theory]
    [InlineData("10:00:00", "09:00:00", "18:00:00", true)]
    [InlineData("08:59:59", "09:00:00", "18:00:00", false)]
    [InlineData("18:00:00", "09:00:00", "18:00:00", false)]
    [InlineData("17:59:59", "09:00:00", "18:00:00", true)]
    public void SameDay_HalfOpenInterval(string now, string start, string end, bool expected)
    {
        ConnectionScheduleWindow
            .Contains(TimeOnly.Parse(now), TimeOnly.Parse(start), TimeOnly.Parse(end))
            .Should().Be(expected);
    }

    [Theory]
    [InlineData("06:00:00", "06:00:00", "01:00:00", true)]
    [InlineData("23:00:00", "06:00:00", "01:00:00", true)]
    [InlineData("00:30:00", "06:00:00", "01:00:00", true)]
    [InlineData("01:00:00", "06:00:00", "01:00:00", false)]
    [InlineData("05:59:59", "06:00:00", "01:00:00", false)]
    public void Overnight_HalfOpenInterval(string now, string start, string end, bool expected)
    {
        ConnectionScheduleWindow
            .Contains(TimeOnly.Parse(now), TimeOnly.Parse(start), TimeOnly.Parse(end))
            .Should().Be(expected);
    }
}
