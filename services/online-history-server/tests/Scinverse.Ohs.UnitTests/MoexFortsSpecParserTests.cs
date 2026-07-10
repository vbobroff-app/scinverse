using FluentAssertions;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

public sealed class MoexFortsSpecParserTests
{
    private static readonly DateOnly AsOf = new(2026, 7, 1);
    private readonly MoexFortsSpecParser _parser = new();

    [Fact]
    public void TryParse_Futures_ExtractsUnderlyingAndExpiration()
    {
        var ok = _parser.TryParse(new InstrumentKey("SiU6", "FUT"), "FUT", AsOf, out var spec);

        ok.Should().BeTrue();
        spec!.UnderlyingCode.Should().Be("Si");
        spec.UnderlyingFuturesCode.Should().Be("SiU6");
        spec.OptionType.Should().BeNull();
        spec.Strike.Should().BeNull();
        // Сентябрь 2026, 3-я пятница — 18-е.
        spec.Expiration.Should().Be(new DateOnly(2026, 9, 18));
    }

    [Fact]
    public void TryParse_CallOption_ExtractsStrikeTypeAndFuturesCode()
    {
        var ok = _parser.TryParse(new InstrumentKey("SiU6C65000", "OPT"), "OPT", AsOf, out var spec);

        ok.Should().BeTrue();
        spec!.UnderlyingCode.Should().Be("Si");
        spec.UnderlyingFuturesCode.Should().Be("SiU6");
        spec.OptionType.Should().Be('C');
        spec.Strike.Should().Be(65000m);
        spec.Expiration.Should().Be(new DateOnly(2026, 9, 18));
    }

    [Fact]
    public void TryParse_PutOption_ExtractsPutType()
    {
        var ok = _parser.TryParse(new InstrumentKey("SiU6P70000", "OPT"), "OPT", AsOf, out var spec);

        ok.Should().BeTrue();
        spec!.OptionType.Should().Be('P');
        spec.Strike.Should().Be(70000m);
    }

    [Theory]
    [InlineData("SBER", "SHARE")]
    [InlineData("SBER", null)]
    [InlineData("Si65000", "OPT")] // нет буквы месяца/типа → не распознано
    public void TryParse_NonDerivativeOrUnknown_ReturnsFalse(string ticker, string? secType)
    {
        var ok = _parser.TryParse(new InstrumentKey(ticker, "TQBR"), secType, AsOf, out var spec);

        ok.Should().BeFalse();
        spec.Should().BeNull();
    }
}
