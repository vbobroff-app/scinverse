using FluentAssertions;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

public sealed class MoexScheduleTests
{
    [Theory]
    // Пн–Пт 2026-07-06..10 — будни: 08:50–23:50.
    [InlineData(2026, 7, 6)]
    [InlineData(2026, 7, 10)]
    public void Session_Weekday_Returns0850To2350Msk(int year, int month, int day)
    {
        var session = MoexSchedule.Session(new DateOnly(year, month, day));

        session.Weekend.Should().BeFalse();
        session.Start.Should().Be(new DateTimeOffset(year, month, day, 8, 50, 0, MoexSchedule.MoscowOffset));
        session.End.Should().Be(new DateTimeOffset(year, month, day, 23, 50, 0, MoexSchedule.MoscowOffset));
    }

    [Theory]
    // Сб 2026-07-11, Вс 2026-07-12 — доп. сессия выходного дня: 09:50–19:00.
    [InlineData(2026, 7, 11)]
    [InlineData(2026, 7, 12)]
    public void Session_Weekend_Returns0950To1900Msk(int year, int month, int day)
    {
        var session = MoexSchedule.Session(new DateOnly(year, month, day));

        session.Weekend.Should().BeTrue();
        session.Start.Should().Be(new DateTimeOffset(year, month, day, 9, 50, 0, MoexSchedule.MoscowOffset));
        session.End.Should().Be(new DateTimeOffset(year, month, day, 19, 0, 0, MoexSchedule.MoscowOffset));
    }

    [Fact]
    public void Session_UsesMoscowOffsetPlus3()
    {
        var session = MoexSchedule.Session(new DateOnly(2026, 7, 10));

        session.Start.Offset.Should().Be(TimeSpan.FromHours(3));
        session.Date.Should().Be(new DateOnly(2026, 7, 10));
    }
}
