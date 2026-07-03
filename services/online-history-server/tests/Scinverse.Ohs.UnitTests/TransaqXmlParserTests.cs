using FluentAssertions;
using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

public sealed class TransaqXmlParserTests
{
    private readonly TransaqXmlParser _parser = new();

    [Fact]
    public void Parse_Alltrades_MapsTradeFields()
    {
        const string xml =
            "<alltrades><trade>" +
            "<tradeno>42</tradeno><board>TQBR</board><seccode>SBER</seccode>" +
            "<time>01.07.2026 10:00:00.500</time><price>250.13</price>" +
            "<quantity>7</quantity><buysell>B</buysell><openinterest>0</openinterest>" +
            "</trade></alltrades>";

        var trade = _parser.Parse(xml).OfType<TradeEvent>().Single();

        trade.Key.Should().Be(new InstrumentKey("SBER", "TQBR"));
        trade.TradeNo.Should().Be(42);
        trade.Price.Should().Be(250.13m);
        trade.Quantity.Should().Be(7);
        trade.Side.Should().Be(MarketSide.Buy);
        trade.OpenInterest.Should().Be(0);
        trade.Timestamp.Should().Be(new DateTimeOffset(2026, 7, 1, 10, 0, 0, 500, TimeSpan.FromHours(3)));
    }

    [Fact]
    public void Parse_Alltrades_SellSide()
    {
        const string xml =
            "<alltrades><trade>" +
            "<tradeno>1</tradeno><board>TQBR</board><seccode>SBER</seccode>" +
            "<time>01.07.2026 10:00:00</time><price>100</price>" +
            "<quantity>1</quantity><buysell>S</buysell>" +
            "</trade></alltrades>";

        var trade = _parser.Parse(xml).OfType<TradeEvent>().Single();

        trade.Side.Should().Be(MarketSide.Sell);
        trade.OpenInterest.Should().BeNull();
    }

    [Fact]
    public void Parse_Securities_MapsReferenceFields()
    {
        const string xml =
            "<securities><security secid=\"5\">" +
            "<seccode>SBER</seccode><board>TQBR</board><market>1</market>" +
            "<shortname>Sberbank</shortname><decimals>2</decimals><minstep>0.01</minstep>" +
            "<lotsize>10</lotsize><point_cost>1</point_cost><sectype>SHARE</sectype>" +
            "</security></securities>";

        var security = _parser.Parse(xml).OfType<SecurityInfo>().Single();

        security.Key.Should().Be(new InstrumentKey("SBER", "TQBR"));
        security.TransaqSecid.Should().Be(5);
        security.MarketId.Should().Be(1);
        security.Decimals.Should().Be(2);
        security.MinStep.Should().Be(0.01m);
        security.LotSize.Should().Be(10);
        security.SecType.Should().Be("SHARE");
    }

    [Fact]
    public void Parse_UnknownRoot_ReturnsEmpty()
    {
        _parser.Parse("<pits><pit/></pits>").Should().BeEmpty();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("<alltrades><trade>broken")]
    public void Parse_InvalidInput_ReturnsEmpty(string xml)
    {
        _parser.Parse(xml).Should().BeEmpty();
    }
}
