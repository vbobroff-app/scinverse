using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Scinverse.Ohs.Domain;

/// <summary>
/// Разбор кодов MOEX FORTS (эвристика по конвенциям кодов; точные дата/тип в проде уточняются из
/// TRANSAQ <c>sec_info</c> — см. docs/dev/phase7/issue.md). Поддерживаемые формы:
/// <list type="bullet">
/// <item>Фьючерс: <c>&lt;base&gt;&lt;monthLetter&gt;&lt;yearDigit&gt;</c> — напр. <c>SiU6</c>.</item>
/// <item>Опцион: <c>&lt;base&gt;&lt;monthLetter&gt;&lt;yearDigit&gt;&lt;C|P&gt;&lt;strike&gt;</c> —
///   напр. <c>SiU6C65000</c>.</item>
/// </list>
/// </summary>
public sealed partial class MoexFortsSpecParser : IDerivativeSpecParser
{
    // Фьючерсные буквы месяца исполнения → номер месяца.
    private static readonly Dictionary<char, int> MonthLetters = new()
    {
        ['F'] = 1, ['G'] = 2, ['H'] = 3, ['J'] = 4, ['K'] = 5, ['M'] = 6,
        ['N'] = 7, ['Q'] = 8, ['U'] = 9, ['V'] = 10, ['X'] = 11, ['Z'] = 12
    };

    public bool TryParse(InstrumentKey key, string? secType, DateOnly asOf, [NotNullWhen(true)] out DerivativeSpec? spec)
    {
        spec = null;
        if (string.IsNullOrWhiteSpace(secType) || string.IsNullOrWhiteSpace(key.Ticker))
        {
            return false;
        }

        return secType.ToUpperInvariant() switch
        {
            "FUT" => TryParseFutures(key.Ticker, asOf, out spec),
            "OPT" => TryParseOption(key.Ticker, asOf, out spec),
            _ => false
        };
    }

    private static bool TryParseFutures(string ticker, DateOnly asOf, [NotNullWhen(true)] out DerivativeSpec? spec)
    {
        spec = null;
        var match = FuturesRegex().Match(ticker);
        if (!match.Success || !TryMonth(match.Groups["m"].Value[0], out var month))
        {
            return false;
        }

        var year = ExpandYear(match.Groups["y"].Value[0], asOf);
        spec = new DerivativeSpec
        {
            UnderlyingCode = match.Groups["base"].Value,
            Expiration = ThirdFriday(year, month),
            UnderlyingFuturesCode = ticker
        };
        return true;
    }

    private static bool TryParseOption(string ticker, DateOnly asOf, [NotNullWhen(true)] out DerivativeSpec? spec)
    {
        spec = null;
        var match = OptionRegex().Match(ticker);
        if (!match.Success || !TryMonth(match.Groups["m"].Value[0], out var month)
            || !decimal.TryParse(match.Groups["strike"].Value, NumberStyles.Number, CultureInfo.InvariantCulture, out var strike))
        {
            return false;
        }

        var yearChar = match.Groups["y"].Value[0];
        var year = ExpandYear(yearChar, asOf);
        var baseCode = match.Groups["base"].Value;
        spec = new DerivativeSpec
        {
            UnderlyingCode = baseCode,
            Expiration = ThirdFriday(year, month),
            OptionType = char.ToUpperInvariant(match.Groups["cp"].Value[0]),
            Strike = strike,
            UnderlyingFuturesCode = $"{baseCode}{match.Groups["m"].Value}{yearChar}"
        };
        return true;
    }

    private static bool TryMonth(char letter, out int month) =>
        MonthLetters.TryGetValue(char.ToUpperInvariant(letter), out month);

    /// <summary>Разворачивает цифру года в ближайший год (≥ asOf−1), оканчивающийся на неё.</summary>
    private static int ExpandYear(char digit, DateOnly asOf)
    {
        var d = digit - '0';
        var year = asOf.Year - 1;
        while (year % 10 != d)
        {
            year++;
        }

        return year;
    }

    private static DateOnly ThirdFriday(int year, int month)
    {
        var first = new DateOnly(year, month, 1);
        var offset = ((int)DayOfWeek.Friday - (int)first.DayOfWeek + 7) % 7;
        return first.AddDays(offset + 14);
    }

    [GeneratedRegex(@"^(?<base>[A-Za-z]+?)(?<m>[FGHJKMNQUVXZ])(?<y>\d)$")]
    private static partial Regex FuturesRegex();

    [GeneratedRegex(@"^(?<base>[A-Za-z]+?)(?<m>[FGHJKMNQUVXZ])(?<y>\d)(?<cp>[CP])(?<strike>\d+)$")]
    private static partial Regex OptionRegex();
}
