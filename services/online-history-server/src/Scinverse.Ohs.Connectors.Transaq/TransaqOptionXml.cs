using System.Globalization;
using System.Xml.Linq;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Connectors.Transaq;

/// <summary>Парсинг callback XML TRANSAQ для option families / strikes.</summary>
public static class TransaqOptionXml
{
    public static bool IsOptionFamilies(string xml) =>
        xml.Contains("option_families", StringComparison.OrdinalIgnoreCase);

    public static bool IsFamilyStrikes(string xml) =>
        xml.Contains("family_strikes", StringComparison.OrdinalIgnoreCase);

    public static bool IsOptionsFailed(string xml) =>
        xml.Contains("options_failed", StringComparison.OrdinalIgnoreCase);

    public static bool IsSecurities(string xml) =>
        xml.Contains("<securities", StringComparison.OrdinalIgnoreCase);

    public static IReadOnlyList<OptionFamily> ParseFamilies(string xml)
    {
        try
        {
            var doc = XDocument.Parse(xml);
            var root = doc.Root;
            if (root is null)
            {
                return [];
            }

            var list = new List<OptionFamily>();
            // Элементы с mat_date внутри option_families (имя узла семейства в DLL может отличаться).
            foreach (var el in root.Descendants().Where(e =>
                         e.Element("mat_date") is not null
                         || e.Attribute("mat_date") is not null
                         || string.Equals(e.Name.LocalName, "mat_date", StringComparison.OrdinalIgnoreCase)))
            {
                XElement? mat;
                if (el.Name.LocalName.Equals("mat_date", StringComparison.OrdinalIgnoreCase))
                {
                    mat = el;
                }
                else if (el.Element("mat_date") is { } matEl)
                {
                    mat = matEl;
                }
                else if (el.Attribute("mat_date") is { } matAttr)
                {
                    mat = new XElement("mat_date", matAttr.Value);
                }
                else
                {
                    mat = null;
                }
                if (mat is null || !TryParseMatDate(mat.Value, out var exp))
                {
                    continue;
                }

                var parent = el.Name.LocalName.Equals("mat_date", StringComparison.OrdinalIgnoreCase)
                    ? el.Parent
                    : el;
                int? lot = null;
                var lotEl = parent?.Element("lot_size");
                if (lotEl is not null && int.TryParse(lotEl.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var ls))
                {
                    lot = ls;
                }

                var code = parent?.Element("seccode")?.Value
                           ?? parent?.Element("opt_code")?.Value
                           ?? parent?.Attribute("seccode")?.Value;
                list.Add(new OptionFamily(exp, lot, string.IsNullOrWhiteSpace(code) ? null : code.Trim()));
            }

            return list
                .GroupBy(f => f.Expiration)
                .Select(g => g.First())
                .OrderBy(f => f.Expiration)
                .ToList();
        }
        catch (System.Xml.XmlException)
        {
            return [];
        }
    }

    public static IReadOnlyList<OptionStrikeQuote> ParseStrikes(string xml)
    {
        try
        {
            var doc = XDocument.Parse(xml);
            var root = doc.Root;
            if (root is null)
            {
                return [];
            }

            var list = new List<OptionStrikeQuote>();
            foreach (var codeEl in root.Descendants().Where(e =>
                         string.Equals(e.Name.LocalName, "opt_code", StringComparison.OrdinalIgnoreCase)))
            {
                var code = codeEl.Value.Trim();
                if (code.Length == 0)
                {
                    continue;
                }

                var parent = codeEl.Parent ?? codeEl;
                var strike = TryReadDecimal(parent, "strike")
                             ?? TryReadDecimal(parent, "price")
                             ?? TryReadDecimal(parent, "strike_price");
                if (strike is null)
                {
                    continue;
                }

                char? optType = null;
                var typeVal = parent.Element("opt_type")?.Value
                              ?? parent.Element("type")?.Value
                              ?? parent.Element("put_call")?.Value
                              ?? parent.Attribute("type")?.Value;
                if (!string.IsNullOrWhiteSpace(typeVal))
                {
                    var c = char.ToUpperInvariant(typeVal.Trim()[0]);
                    if (c is 'C' or 'P')
                    {
                        optType = c;
                    }
                }

                list.Add(new OptionStrikeQuote(strike.Value, optType, code));
            }

            return list;
        }
        catch (System.Xml.XmlException)
        {
            return [];
        }
    }

    public static bool TryParseMatDate(string? value, out DateOnly date)
    {
        date = default;
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var v = value.Trim();
        if (DateOnly.TryParseExact(v, "dd.MM.yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out date))
        {
            return true;
        }

        return DateOnly.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.None, out date);
    }

    public static string FormatMatDate(DateOnly date) =>
        date.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture);

    /// <summary>Цена из фрагмента alltrades (первая сделка с данным seccode).</summary>
    public static bool TryParseAlltradePrice(string xml, string seccode, out decimal price)
    {
        price = 0;
        if (!xml.Contains("alltrades", StringComparison.OrdinalIgnoreCase)
            || !xml.Contains(seccode, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        try
        {
            var doc = XDocument.Parse(xml);
            foreach (var trade in doc.Descendants().Where(e =>
                         string.Equals(e.Name.LocalName, "trade", StringComparison.OrdinalIgnoreCase)
                         || string.Equals(e.Name.LocalName, "tick", StringComparison.OrdinalIgnoreCase)))
            {
                var code = trade.Element("seccode")?.Value ?? trade.Attribute("seccode")?.Value;
                if (!string.Equals(code, seccode, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var p = trade.Element("price")?.Value ?? trade.Attribute("price")?.Value;
                if (p is not null
                    && decimal.TryParse(p, NumberStyles.Number, CultureInfo.InvariantCulture, out price))
                {
                    return true;
                }
            }
        }
        catch (System.Xml.XmlException)
        {
            return false;
        }

        return false;
    }

    private static decimal? TryReadDecimal(XElement parent, string name)
    {
        var raw = parent.Element(name)?.Value ?? parent.Attribute(name)?.Value;
        if (raw is null)
        {
            return null;
        }

        return decimal.TryParse(raw, NumberStyles.Number, CultureInfo.InvariantCulture, out var d)
            ? d
            : null;
    }
}
