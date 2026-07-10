using FluentAssertions;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

public sealed class MoexFortsSpecParserTests
{
    private static readonly DateOnly AsOf = new(2026, 7, 1);
    private readonly MoexFortsSpecParser _parser = new();

    [Fact]
    public void TryParse_TickerFutures_ExtractsUnderlyingAndExpiration()
    {
        var ok = _parser.TryParse(new InstrumentKey("SiU6", "FUT"), "FUT", shortName: null, AsOf, out var spec);

        ok.Should().BeTrue();
        spec!.UnderlyingCode.Should().Be("Si");
        spec.UnderlyingFuturesCode.Should().Be("SiU6");
        spec.OptionType.Should().BeNull();
        spec.Strike.Should().BeNull();
        // Сентябрь 2026, 3-я пятница — 18-е.
        spec.Expiration.Should().Be(new DateOnly(2026, 9, 18));
    }

    [Fact]
    public void TryParse_TickerCallOption_ExtractsStrikeTypeAndFuturesCode()
    {
        var ok = _parser.TryParse(new InstrumentKey("SiU6C65000", "OPT"), "OPT", shortName: null, AsOf, out var spec);

        ok.Should().BeTrue();
        spec!.UnderlyingCode.Should().Be("Si");
        spec.UnderlyingFuturesCode.Should().Be("SiU6");
        spec.OptionType.Should().Be('C');
        spec.Strike.Should().Be(65000m);
        spec.Expiration.Should().Be(new DateOnly(2026, 9, 18));
    }

    [Fact]
    public void TryParse_TickerPutOption_ExtractsPutType()
    {
        var ok = _parser.TryParse(new InstrumentKey("SiU6P70000", "OPT"), "OPT", shortName: null, AsOf, out var spec);

        ok.Should().BeTrue();
        spec!.OptionType.Should().Be('P');
        spec.Strike.Should().Be(70000m);
    }

    [Fact]
    public void TryParse_RealFutures_FromShortName()
    {
        var ok = _parser.TryParse(new InstrumentKey("SiU6", "FUT"), "FUT", "Si-9.26", AsOf, out var spec);

        ok.Should().BeTrue();
        spec!.UnderlyingCode.Should().Be("Si");
        spec.UnderlyingShortName.Should().Be("Si-9.26");
        spec.OptionType.Should().BeNull();
        spec.Expiration.Month.Should().Be(9);
        spec.Expiration.Year.Should().Be(2026);
    }

    [Fact]
    public void TryParse_RealCallOption_FromShortName()
    {
        var ok = _parser.TryParse(
            new InstrumentKey("Si80000BG6", "OPT"), "OPT", "Si-9.26M160726CA80000", AsOf, out var spec);

        ok.Should().BeTrue();
        spec!.UnderlyingCode.Should().Be("Si");
        spec.UnderlyingShortName.Should().Be("Si-9.26");
        spec.OptionType.Should().Be('C');
        spec.Strike.Should().Be(80000m);
        spec.Expiration.Should().Be(new DateOnly(2026, 7, 16));
    }

    [Fact]
    public void TryParse_RealPutOption_FromShortName()
    {
        var ok = _parser.TryParse(
            new InstrumentKey("Si69500BS6", "OPT"), "OPT", "Si-9.26M160726PA69500", AsOf, out var spec);

        ok.Should().BeTrue();
        spec!.OptionType.Should().Be('P');
        spec.Strike.Should().Be(69500m);
    }

    [Fact]
    public void TryParse_CalendarSpread_ShortName_ReturnsFalse()
    {
        var ok = _parser.TryParse(new InstrumentKey("SiU6SiZ6", "FUT"), "FUT", "Si-9.26-12.26", AsOf, out var spec);

        ok.Should().BeFalse();
        spec.Should().BeNull();
    }

    [Theory]
    [InlineData("SBER", "SHARE")]
    [InlineData("SBER", null)]
    [InlineData("Si65000", "OPT")] // нет буквы месяца/типа → не распознано
    public void TryParse_NonDerivativeOrUnknown_ReturnsFalse(string ticker, string? secType)
    {
        var ok = _parser.TryParse(new InstrumentKey(ticker, "TQBR"), secType, shortName: null, AsOf, out var spec);

        ok.Should().BeFalse();
        spec.Should().BeNull();
    }
}
