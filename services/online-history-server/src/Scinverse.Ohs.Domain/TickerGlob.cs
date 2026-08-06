using System.Text;
using System.Text.RegularExpressions;

namespace Scinverse.Ohs.Domain;

/// <summary>
/// Glob по <c>ticker</c>: <c>*</c>, <c>?</c>, классы <c>[0-9]</c> / <c>[2-9]</c>; ignore-case.
/// Несколько паттернов — OR (вызывающий сторону).
/// </summary>
public static class TickerGlob
{
    /// <summary>True, если <paramref name="ticker"/> матчит хотя бы один паттерн.</summary>
    public static bool IsMatch(string ticker, IReadOnlyList<string> patterns)
    {
        if (string.IsNullOrEmpty(ticker) || patterns is null || patterns.Count == 0)
        {
            return false;
        }

        foreach (var pattern in patterns)
        {
            if (string.IsNullOrWhiteSpace(pattern))
            {
                continue;
            }

            if (IsMatch(ticker, pattern.Trim()))
            {
                return true;
            }
        }

        return false;
    }

    public static bool IsMatch(string ticker, string pattern)
    {
        if (string.IsNullOrEmpty(ticker) || string.IsNullOrWhiteSpace(pattern))
        {
            return false;
        }

        var regex = ToRegex(pattern.Trim());
        return regex.IsMatch(ticker);
    }

    public static Regex ToRegex(string pattern)
    {
        var sb = new StringBuilder(pattern.Length * 2);
        sb.Append('^');

        for (var i = 0; i < pattern.Length; i++)
        {
            var c = pattern[i];
            switch (c)
            {
                case '*':
                    sb.Append(".*");
                    break;
                case '?':
                    sb.Append('.');
                    break;
                case '[':
                {
                    var close = pattern.IndexOf(']', i + 1);
                    if (close < 0)
                    {
                        // Нет закрывающей — литерал '['.
                        sb.Append("\\[");
                        break;
                    }

                    // Класс символов как в glob/shell — переносим as-is.
                    sb.Append(pattern, i, close - i + 1);
                    i = close;
                    break;
                }
                default:
                    if (RegexMeta(c))
                    {
                        sb.Append('\\');
                    }

                    sb.Append(c);
                    break;
            }
        }

        sb.Append('$');
        return new Regex(sb.ToString(), RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);
    }

    private static bool RegexMeta(char c) => c is '.' or '^' or '$' or '{' or '}' or '(' or ')'
        or '|' or '+' or '\\';
}
