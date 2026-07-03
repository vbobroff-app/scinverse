using System.Globalization;
using System.Xml;
using System.Xml.Linq;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Connectors.Transaq;

/// <summary>
/// Anti-Corruption Layer TRANSAQ: превращает XML-фрагменты (alltrades / securities)
/// в доменные сообщения. Неизвестные корневые теги игнорируются.
/// </summary>
public sealed class TransaqXmlParser : ITransaqParser
{
    public IEnumerable<IMarketMessage> Parse(string xml)
    {
        if (string.IsNullOrWhiteSpace(xml))
        {
            return [];
        }

        XDocument document;
        try
        {
            document = XDocument.Parse(xml);
        }
        catch (XmlException)
        {
            return [];
        }

        var root = document.Root;
        return root?.Name.LocalName switch
        {
            "alltrades" => ParseTrades(root),
            "securities" => ParseSecurities(root),
            _ => []
        };
    }

    private static IEnumerable<IMarketMessage> ParseTrades(XElement root)
    {
        foreach (var trade in root.Elements("trade"))
        {
            var seccode = (string?)trade.Element("seccode");
            var board = (string?)trade.Element("board");
            var tradeNo = (string?)trade.Element("tradeno");
            var time = (string?)trade.Element("time");
            var price = (string?)trade.Element("price");
            var quantity = (string?)trade.Element("quantity");
            var buySell = (string?)trade.Element("buysell");

            if (seccode is null || board is null || tradeNo is null || time is null
                || price is null || quantity is null || buySell is null)
            {
                continue;
            }

            yield return new TradeEvent
            {
                Key = new InstrumentKey(seccode, board),
                TradeNo = long.Parse(tradeNo, CultureInfo.InvariantCulture),
                Timestamp = TransaqTime.Parse(time),
                Price = decimal.Parse(price, CultureInfo.InvariantCulture),
                Quantity = int.Parse(quantity, CultureInfo.InvariantCulture),
                Side = buySell.Equals("B", StringComparison.OrdinalIgnoreCase)
                    ? MarketSide.Buy
                    : MarketSide.Sell,
                OpenInterest = ParseNullableLong((string?)trade.Element("openinterest"))
            };
        }
    }

    private static IEnumerable<IMarketMessage> ParseSecurities(XElement root)
    {
        foreach (var security in root.Elements("security"))
        {
            var seccode = (string?)security.Element("seccode");
            var board = (string?)security.Element("board");
            var minStep = (string?)security.Element("minstep");

            if (seccode is null || board is null || minStep is null)
            {
                continue;
            }

            yield return new SecurityInfo
            {
                Key = new InstrumentKey(seccode, board),
                TransaqSecid = ParseNullableInt(security.Attribute("secid")?.Value),
                MarketId = ParseNullableInt((string?)security.Element("market")),
                ShortName = (string?)security.Element("shortname"),
                Name = (string?)security.Element("shortname"),
                SecType = (string?)security.Element("sectype"),
                Decimals = ParseShort((string?)security.Element("decimals")),
                MinStep = decimal.Parse(minStep, CultureInfo.InvariantCulture),
                LotSize = ParseNullableInt((string?)security.Element("lotsize")),
                PointCost = ParseNullableDecimal((string?)security.Element("point_cost")),
                Currency = (string?)security.Element("currency")
            };
        }
    }

    private static int? ParseNullableInt(string? value) =>
        value is null ? null : int.Parse(value, CultureInfo.InvariantCulture);

    private static long? ParseNullableLong(string? value) =>
        value is null ? null : long.Parse(value, CultureInfo.InvariantCulture);

    private static decimal? ParseNullableDecimal(string? value) =>
        value is null ? null : decimal.Parse(value, CultureInfo.InvariantCulture);

    private static short ParseShort(string? value) =>
        value is null ? (short)0 : short.Parse(value, CultureInfo.InvariantCulture);
}
