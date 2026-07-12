using FluentAssertions;
using Scinverse.Ohs.Domain.Moex;

namespace Scinverse.Ohs.UnitTests;

public sealed class EngineCalendarTests
{
    // Модель FORTS: все 7 дней рабочие 07:00–23:59:59 + исключения по датам (как отдаёт ISS).
    private static EngineCalendar Forts() => EngineCalendar.Build(
        timetable: Enumerable.Range(1, 7).Select(d =>
            (d, true, (TimeOnly?)new TimeOnly(7, 0), (TimeOnly?)new TimeOnly(23, 59, 59))),
        dailytable:
        [
            (new DateOnly(2026, 5, 1), false, null, null),                                   // праздник
            (new DateOnly(2026, 6, 12), true, new TimeOnly(6, 0), new TimeOnly(23, 59, 59)), // перенос (рабочий)
            (new DateOnly(2026, 11, 4), false, new TimeOnly(10, 0), new TimeOnly(19, 0)),    // сокращённый (неторг.)
        ]);

    [Fact]
    public void Weekday_UsesWeeklyHours()
    {
        Forts().TryResolve(new DateOnly(2026, 7, 13), out var trading, out var open, out var close)
            .Should().BeTrue(); // пн
        trading.Should().BeTrue();
        open.Should().Be(new TimeOnly(7, 0));
        close.Should().Be(new TimeOnly(23, 59, 59));
    }

    [Fact]
    public void Holiday_IsNotTrading()
    {
        Forts().TryResolve(new DateOnly(2026, 5, 1), out var trading, out _, out _).Should().BeTrue();
        trading.Should().BeFalse();
    }

    [Fact]
    public void TransferDay_UsesOverrideHours()
    {
        Forts().TryResolve(new DateOnly(2026, 6, 12), out var trading, out var open, out _).Should().BeTrue();
        trading.Should().BeTrue();
        open.Should().Be(new TimeOnly(6, 0));
    }

    [Fact]
    public void ShortNonTradingHoliday_IsNotTrading_DespiteHours()
    {
        // is_work_day=0 но с часами (историческое сокращённое закрытие) — всё равно НЕ торговый.
        Forts().TryResolve(new DateOnly(2026, 11, 4), out var trading, out _, out _).Should().BeTrue();
        trading.Should().BeFalse();
    }

    [Fact]
    public void UnknownDate_WithoutWeeklyRule_ReturnsFalse()
    {
        var empty = EngineCalendar.Build(timetable: [], dailytable: []);
        empty.TryResolve(new DateOnly(2026, 7, 13), out _, out _, out _).Should().BeFalse();
    }
}
