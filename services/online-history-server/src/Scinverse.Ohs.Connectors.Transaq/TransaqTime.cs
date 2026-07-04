using System.Globalization;

namespace Scinverse.Ohs.Connectors.Transaq;

/// <summary>
/// TRANSAQ отдаёт время в МСК (UTC+3), формат dd.MM.yyyy HH:mm:ss[.fff].
/// Приводим к <see cref="DateTimeOffset"/> с явным смещением +03:00.
/// </summary>
internal static class TransaqTime
{
    private static readonly TimeSpan MoscowOffset = TimeSpan.FromHours(3);

    private static readonly string[] Formats =
    [
        "dd.MM.yyyy HH:mm:ss.fff",
        "dd.MM.yyyy HH:mm:ss"
    ];

    public static DateTimeOffset Parse(string value)
    {
        var parsed = DateTime.ParseExact(
            value.Trim(), Formats, CultureInfo.InvariantCulture, DateTimeStyles.None);
        return new DateTimeOffset(parsed, MoscowOffset);
    }

    public static bool TryParse(string? value, out DateTimeOffset result)
    {
        if (value is not null
            && DateTime.TryParseExact(
                value.Trim(), Formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
        {
            result = new DateTimeOffset(parsed, MoscowOffset);
            return true;
        }

        result = default;
        return false;
    }
}
