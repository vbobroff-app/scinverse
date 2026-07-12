using FluentAssertions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Domain.Moex;

namespace Scinverse.Ohs.UnitTests;

public sealed class TradingCalendarTests
{
    private static EngineCalendar Forts() => EngineCalendar.Build(
        timetable: Enumerable.Range(1, 7).Select(d =>
            (d, true, (TimeOnly?)new TimeOnly(7, 0), (TimeOnly?)new TimeOnly(23, 59, 59))),
        dailytable: [(new DateOnly(2026, 5, 1), false, null, null)]);

    [Fact]
    public void Weekday_UsesCalendarHours()
    {
        var monday = new DateOnly(2026, 7, 13);
        var sessions = TradingCalendar.Shape(Forts(), [monday]);

        sessions.Should().HaveCount(1);
        sessions[0].Weekend.Should().BeFalse();
        sessions[0].Start.Should().Be(new DateTimeOffset(2026, 7, 13, 7, 0, 0, MoexSchedule.MoscowOffset));
        sessions[0].End.Should().Be(new DateTimeOffset(2026, 7, 13, 23, 59, 59, MoexSchedule.MoscowOffset));
    }

    [Fact]
    public void Holiday_IsDropped()
    {
        var sessions = TradingCalendar.Shape(Forts(), [new DateOnly(2026, 5, 1)]);
        sessions.Should().BeEmpty();
    }

    [Fact]
    public void Weekend_UsesNarrowDsvdHours_NotWideEngineWindow()
    {
        var saturday = new DateOnly(2026, 7, 11);
        var sessions = TradingCalendar.Shape(Forts(), [saturday]);

        sessions.Should().HaveCount(1);
        sessions[0].Weekend.Should().BeTrue();
        // Узкое окно ДСВД (MoexSchedule 09:50–19:00), а не широкое 07:00–23:59:59 движка.
        sessions[0].Start.Should().Be(new DateTimeOffset(2026, 7, 11, 9, 50, 0, MoexSchedule.MoscowOffset));
        sessions[0].End.Should().Be(new DateTimeOffset(2026, 7, 11, 19, 0, 0, MoexSchedule.MoscowOffset));
    }

    [Fact]
    public void NullCalendar_FallsBackToHeuristic_KeepsAllDates()
    {
        var monday = new DateOnly(2026, 7, 13);
        var holiday = new DateOnly(2026, 5, 1); // эвристика не знает праздников → не отбрасывает
        var sessions = TradingCalendar.Shape(calendar: null, [monday, holiday]);

        sessions.Should().HaveCount(2);
        // Будний эвристический старт 08:50.
        sessions[0].Start.Should().Be(new DateTimeOffset(2026, 7, 13, 8, 50, 0, MoexSchedule.MoscowOffset));
    }
}
