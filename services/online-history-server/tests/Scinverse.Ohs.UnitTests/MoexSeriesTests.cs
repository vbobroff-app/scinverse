using FluentAssertions;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

public sealed class MoexSeriesTests
{
    [Theory]
    [InlineData("Si", 2026, 7, 16, "Si N26")]
    [InlineData("Si", 2026, 8, 20, "Si Q26")]
    [InlineData("Si", 2026, 9, 17, "Si U26")]
    public void Label_UsesFuturesMonthCodeAndYear(string code, int year, int month, int day, string expected)
    {
        MoexSeries.Label(code, new DateOnly(year, month, day)).Should().Be(expected);
    }

    [Fact]
    public void Label_WithoutUnderlyingCode_OmitsPrefix()
    {
        MoexSeries.Label(null, new DateOnly(2026, 12, 17)).Should().Be("Z26");
    }

    [Theory]
    // Недельные (есть неделя): W1..W5.
    [InlineData(2026, 7, 2, 1, "W1")]
    [InlineData(2026, 7, 9, 2, "W2")]
    // Месячные (неделя null, месяц не кратен 3): M{месяц}.
    [InlineData(2026, 7, 16, null, "M7")]
    [InlineData(2026, 8, 20, null, "M8")]
    // Квартальные (неделя null, месяц мар/июн/сен/дек): Q{квартал}.
    [InlineData(2026, 9, 17, null, "Q3")]
    [InlineData(2026, 12, 17, null, "Q4")]
    [InlineData(2026, 3, 19, null, "Q1")]
    public void Badge_ClassifiesWeeklyMonthlyQuarterly(int year, int month, int day, int? week, string expected)
    {
        MoexSeries.Badge(new DateOnly(year, month, day), week).Should().Be(expected);
    }

    [Theory]
    [InlineData("Si80000BG6", null)]   // месячный: оканчивается на цифру года
    [InlineData("Si80000BG6A", 1)]     // недельный: A — 1-я неделя
    [InlineData("Si69500BS6D", 4)]     // недельный: D — 4-я неделя
    [InlineData("RI130000BA0A", 1)]    // пример MOEX
    [InlineData(null, null)]
    [InlineData("", null)]
    public void WeekFromShortCode_ReadsWeekField(string? shortCode, int? expected)
    {
        MoexSeries.WeekFromShortCode(shortCode).Should().Be(expected);
    }
}
