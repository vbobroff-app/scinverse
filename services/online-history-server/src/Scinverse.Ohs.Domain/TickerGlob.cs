using System.Text;
using System.Text.RegularExpressions;

namespace Scinverse.Ohs.Domain;

/// <summary>
/// Glob-движок для обозначений инструментов (<c>short_name</c> / MOEX
/// <c>XXXX-&lt;месяц&gt;.&lt;год&gt;</c>): <c>*</c>, <c>?</c>, классы <c>[0-9]</c>; ignore-case.
/// Несколько паттернов — OR (вызывающий сторону). Имя класса историческое.
/// </summary>
public static class TickerGlob
{
    /// <summary>
    /// Компилирует паттерны один раз (для eval по тысячам строк).
    /// Без этого <see cref="RegexOptions.Compiled"/> на каждую строку вешает preview/save.
    /// </summary>
    public static Func<string, bool> Compile(IReadOnlyList<string> patterns)
    {
        if (patterns is null || patterns.Count == 0)
        {
            return static _ => false;
        }

        var regexes = new List<Regex>();
        foreach (var pattern in patterns)
        {
            if (string.IsNullOrWhiteSpace(pattern))
            {
                continue;
            }

            regexes.Add(ToRegex(pattern.Trim()));
        }

        if (regexes.Count == 0)
        {
            return static _ => false;
        }

        var frozen = regexes.ToArray();
        return ticker =>
        {
            if (string.IsNullOrEmpty(ticker))
            {
                return false;
            }

            foreach (var regex in frozen)
            {
                if (regex.IsMatch(ticker))
                {
                    return true;
                }
            }

            return false;
        };
    }

    /// <summary>True, если <paramref name="ticker"/> матчит хотя бы один паттерн.</summary>
    public static bool IsMatch(string ticker, IReadOnlyList<string> patterns) =>
        Compile(patterns)(ticker);

    public static bool IsMatch(string ticker, string pattern)
    {
        if (string.IsNullOrEmpty(ticker) || string.IsNullOrWhiteSpace(pattern))
        {
            return false;
        }

        return ToRegex(pattern.Trim()).IsMatch(ticker);
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
        // Compiled — только через Compile(...) один раз на набор паттернов, не на каждый тикер.
        return new Regex(sb.ToString(), RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);
    }

    private static bool RegexMeta(char c) => c is '.' or '^' or '$' or '{' or '}' or '(' or ')'
        or '|' or '+' or '\\';
}
