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
            var ticker = (string?)trade.Element("seccode");
            var board = (string?)trade.Element("board");
            var buySell = (string?)trade.Element("buysell");

            // Обязательные поля: пропускаем битую запись целиком, а не роняем конвейер.
            if (string.IsNullOrEmpty(ticker) || string.IsNullOrEmpty(board) || string.IsNullOrEmpty(buySell)
                || !TryLong((string?)trade.Element("tradeno"), out var tradeNo)
                || !TransaqTime.TryParse((string?)trade.Element("time"), out var timestamp)
                || !TryDecimal((string?)trade.Element("price"), out var price)
                || !TryInt((string?)trade.Element("quantity"), out var quantity))
            {
                continue;
            }

            yield return new TradeEvent
            {
                Key = new InstrumentKey(ticker, board),
                TradeNo = tradeNo,
                Timestamp = timestamp,
                Price = price,
                Quantity = quantity,
                Side = buySell.Equals("B", StringComparison.OrdinalIgnoreCase)
                    ? MarketSide.Buy
                    : MarketSide.Sell,
                OpenInterest = TryLong((string?)trade.Element("openinterest"), out var oi) ? oi : null
            };
        }
    }

    private static IEnumerable<IMarketMessage> ParseSecurities(XElement root)
    {
        foreach (var security in root.Elements("security"))
        {
            var ticker = (string?)security.Element("seccode");
            var board = (string?)security.Element("board");

            if (string.IsNullOrEmpty(ticker) || string.IsNullOrEmpty(board)
                || !TryDecimal((string?)security.Element("minstep"), out var minStep))
            {
                continue;
            }

            yield return new SecurityInfo
            {
                Key = new InstrumentKey(ticker, board),
                TransaqSecId = TryInt(security.Attribute("secid")?.Value, out var secid) ? secid : null,
                MarketId = TryInt((string?)security.Element("market"), out var market) ? market : null,
                ShortName = (string?)security.Element("shortname"),
                // Полное имя в секции TRANSAQ securities отсутствует; оставляем null
                // до появления отдельного источника (приравнивать к ShortName некорректно).
                Name = null,
                SecType = (string?)security.Element("sectype"),
                Decimals = TryShort((string?)security.Element("decimals"), out var decimals) ? decimals : (short)0,
                MinStep = minStep,
                LotSize = TryInt((string?)security.Element("lotsize"), out var lotSize) ? lotSize : null,
                PointCost = TryDecimal((string?)security.Element("point_cost"), out var pointCost) ? pointCost : null,
                Currency = (string?)security.Element("currency")
            };
        }
    }

    private static bool TryInt(string? value, out int result) =>
        int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out result);

    private static bool TryLong(string? value, out long result) =>
        long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out result);

    private static bool TryShort(string? value, out short result) =>
        short.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out result);

    private static bool TryDecimal(string? value, out decimal result) =>
        decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out result);
}
