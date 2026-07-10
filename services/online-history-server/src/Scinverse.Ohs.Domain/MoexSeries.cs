using System.Text.RegularExpressions;

namespace Scinverse.Ohs.Domain;

/// <summary>
/// Подписи серий опционов MOEX в биржевом виде: <c>Si N26</c> (месячная/квартальная),
/// <c>Si N26 W1</c> (недельная).
/// <list type="bullet">
/// <item>Буква месяца исполнения (поле «M» фьючерса): F G H J K M N Q U V X Z → январь…декабрь.</item>
/// <item>Год — две цифры (<c>26</c> → 2026).</item>
/// <item>Недельность (поле «W» краткого кода): нет буквы → месячный/квартальный;
///   <c>A..E</c> → недельный в 1..5-й четверг месяца. Источник — краткий код (тикер),
///   а не календарь.</item>
/// </list>
/// </summary>
public static partial class MoexSeries
{
    private static readonly char[] MonthCodes =
        ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];

    /// <summary>
    /// Извлекает номер недели (1..5) из поля «W» краткого кода опциона (буква A..E после
    /// цифры года). Возвращает <c>null</c> для месячного/квартального опциона.
    /// </summary>
    public static int? WeekFromShortCode(string? shortCode)
    {
        if (string.IsNullOrWhiteSpace(shortCode))
        {
            return null;
        }

        var match = WeekTailRegex().Match(shortCode);
        return match.Success && match.Groups["w"].Success
            ? match.Groups["w"].Value[0] - 'A' + 1
            : null;
    }

    /// <summary>Строит имя серии по коду базового актива и дате экспирации (напр. <c>Si Q26</c>).</summary>
    public static string Label(string? underlyingCode, DateOnly expiration)
    {
        var series = $"{MonthCodes[expiration.Month - 1]}{expiration.Year % 100:D2}";
        var baseCode = underlyingCode?.Trim();
        return string.IsNullOrEmpty(baseCode) ? series : $"{baseCode} {series}";
    }

    /// <summary>
    /// Нотификатор типа серии: <c>W1..W5</c> — недельная, <c>Q1..Q4</c> — квартальная
    /// (месяц мар/июн/сен/дек), <c>M1..M12</c> — месячная (прочие месяцы).
    /// </summary>
    public static string Badge(DateOnly expiration, int? week)
    {
        if (week is { } w)
        {
            return $"W{w}";
        }

        var month = expiration.Month;
        return month % 3 == 0 ? $"Q{month / 3}" : $"M{month}";
    }

    // Хвост краткого кода: цифра года и опциональная буква недели A..E.
    [GeneratedRegex(@"(?<y>\d)(?<w>[A-E])?$")]
    private static partial Regex WeekTailRegex();
}
