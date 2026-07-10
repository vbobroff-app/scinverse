using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Scinverse.Ohs.Domain;

/// <summary>
/// Разбор деривативов MOEX FORTS. Сначала пробуем реальный формат <c>short_name</c>
/// (как в боевом справочнике TRANSAQ), затем — синтетический формат тикера (демо/тесты).
/// <list type="bullet">
/// <item>Фьючерс short_name: <c>Si-9.26</c> (спреды <c>Si-9.26-12.26</c> — не дериватив).</item>
/// <item>Опцион short_name: <c>Si-9.26M160726CA80000</c> — базовый фьючерс + экспирация(ddMMyy) +
///   тип(C|P) + страйк.</item>
/// <item>Синтетика (тикер): фьючерс <c>SiU6</c>, опцион <c>SiU6C65000</c>.</item>
/// </list>
/// </summary>
public sealed partial class MoexFortsSpecParser : IDerivativeSpecParser
{
    // Фьючерсные буквы месяца исполнения → номер месяца (синтетический формат тикера).
    private static readonly Dictionary<char, int> MonthLetters = new()
    {
        ['F'] = 1, ['G'] = 2, ['H'] = 3, ['J'] = 4, ['K'] = 5, ['M'] = 6,
        ['N'] = 7, ['Q'] = 8, ['U'] = 9, ['V'] = 10, ['X'] = 11, ['Z'] = 12
    };

    public bool TryParse(
        InstrumentKey key, string? secType, string? shortName, DateOnly asOf,
        [NotNullWhen(true)] out DerivativeSpec? spec)
    {
        spec = null;
        if (string.IsNullOrWhiteSpace(secType) || string.IsNullOrWhiteSpace(key.Ticker))
        {
            return false;
        }

        return secType.ToUpperInvariant() switch
        {
            "FUT" => TryParseRealFutures(shortName, key.Ticker, out spec)
                     || TryParseTickerFutures(key.Ticker, asOf, out spec),
            "OPT" => TryParseRealOption(shortName, out spec)
                     || TryParseTickerOption(key.Ticker, asOf, out spec),
            _ => false
        };
    }

    // --- Реальный формат short_name (боевой MOEX/TRANSAQ). ---

    private static bool TryParseRealFutures(string? shortName, string ticker, [NotNullWhen(true)] out DerivativeSpec? spec)
    {
        spec = null;
        if (string.IsNullOrWhiteSpace(shortName))
        {
            return false;
        }

        var match = RealFuturesRegex().Match(shortName);
        if (!match.Success)
        {
            return false;
        }

        var month = int.Parse(match.Groups["mo"].Value, CultureInfo.InvariantCulture);
        var year = 2000 + int.Parse(match.Groups["yy"].Value, CultureInfo.InvariantCulture);
        spec = new DerivativeSpec
        {
            UnderlyingCode = match.Groups["base"].Value,
            Expiration = ThirdFriday(year, month),
            UnderlyingFuturesCode = ticker,
            UnderlyingShortName = shortName
        };
        return true;
    }

    private static bool TryParseRealOption(string? shortName, [NotNullWhen(true)] out DerivativeSpec? spec)
    {
        spec = null;
        if (string.IsNullOrWhiteSpace(shortName))
        {
            return false;
        }

        var match = RealOptionRegex().Match(shortName);
        if (!match.Success
            || !decimal.TryParse(match.Groups["strike"].Value, NumberStyles.Number, CultureInfo.InvariantCulture, out var strike))
        {
            return false;
        }

        var day = int.Parse(match.Groups["d"].Value, CultureInfo.InvariantCulture);
        var month = int.Parse(match.Groups["mo"].Value, CultureInfo.InvariantCulture);
        var year = 2000 + int.Parse(match.Groups["yy"].Value, CultureInfo.InvariantCulture);
        var underlyingShortName = match.Groups["u"].Value;

        spec = new DerivativeSpec
        {
            UnderlyingCode = match.Groups["ubase"].Value,
            Expiration = new DateOnly(year, month, day),
            OptionType = match.Groups["cp"].Value[0],
            Strike = strike,
            UnderlyingShortName = underlyingShortName
        };
        return true;
    }

    // --- Синтетический формат тикера (демо/тесты): SiU6 / SiU6C65000. ---

    private static bool TryParseTickerFutures(string ticker, DateOnly asOf, [NotNullWhen(true)] out DerivativeSpec? spec)
    {
        spec = null;
        var match = TickerFuturesRegex().Match(ticker);
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

    private static bool TryParseTickerOption(string ticker, DateOnly asOf, [NotNullWhen(true)] out DerivativeSpec? spec)
    {
        spec = null;
        var match = TickerOptionRegex().Match(ticker);
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

    [GeneratedRegex(@"^(?<base>[A-Za-z]+)-(?<mo>\d{1,2})\.(?<yy>\d{2})$")]
    private static partial Regex RealFuturesRegex();

    [GeneratedRegex(@"^(?<u>(?<ubase>[A-Za-z]+)-\d{1,2}\.\d{2})M(?<d>\d{2})(?<mo>\d{2})(?<yy>\d{2})(?<cp>[CP])A(?<strike>\d+)$")]
    private static partial Regex RealOptionRegex();

    [GeneratedRegex(@"^(?<base>[A-Za-z]+?)(?<m>[FGHJKMNQUVXZ])(?<y>\d)$")]
    private static partial Regex TickerFuturesRegex();

    [GeneratedRegex(@"^(?<base>[A-Za-z]+?)(?<m>[FGHJKMNQUVXZ])(?<y>\d)(?<cp>[CP])(?<strike>\d+)$")]
    private static partial Regex TickerOptionRegex();
}
