using FluentAssertions;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

public sealed class TickMathTests
{
    [Theory]
    [InlineData(250.13, 0.01, 25013)]
    [InlineData(100.00, 0.01, 10000)]
    [InlineData(1.5, 0.5, 3)]
    public void ToTicks_ConvertsPriceToInteger(decimal price, decimal minStep, long expected)
    {
        TickMath.ToTicks(price, minStep).Should().Be(expected);
    }

    [Fact]
    public void ToTicks_RoundsHalfAwayFromZero()
    {
        TickMath.ToTicks(0.015m, 0.01m).Should().Be(2);
    }

    [Fact]
    public void ToPrice_IsInverseOfToTicks()
    {
        var ticks = TickMath.ToTicks(250.13m, 0.01m);
        TickMath.ToPrice(ticks, 0.01m).Should().Be(250.13m);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-0.01)]
    public void ToTicks_ThrowsWhenMinStepNotPositive(decimal minStep)
    {
        var act = () => TickMath.ToTicks(100m, minStep);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void Instrument_ToTicksAndToPrice_UseOwnMinStep()
    {
        var instrument = new Instrument
        {
            InstrumentId = 1,
            Key = new InstrumentKey("SBER", "TQBR"),
            MinStep = 0.01m
        };

        var ticks = instrument.ToTicks(250.13m);

        ticks.Should().Be(25013);
        instrument.ToPrice(ticks).Should().Be(250.13m);
    }
}
