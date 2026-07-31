namespace Scinverse.Ohs.Domain;

/// <summary>
/// Полуоткрытый интервал <c>[From, To)</c> (UTC или любой согласованный offset).
/// </summary>
public readonly record struct HalfOpenInterval(DateTimeOffset From, DateTimeOffset To);

/// <summary>
/// Schedule-as-projection: type-agnostic клип «нет данных» ∩ desired.
/// Не пишет journal, не меняет NC. Интервалы — <c>[from, to)</c>.
/// Открытый gap (<c>To == null</c>) закрывается в <paramref name="asOf"/> как <c>[From, asOf)</c>.
/// </summary>
public static class ScheduleCutter
{
    /// <summary>
    /// Пересекает gaps с desired-окнами. Пустые / вырожденные (<c>From &gt;= To</c>) отбрасываются.
    /// Результат — клипы по возрастанию <see cref="HalfOpenInterval.From"/>.
    /// </summary>
    public static IReadOnlyList<HalfOpenInterval> Cut(
        IEnumerable<(DateTimeOffset From, DateTimeOffset? To)> gaps,
        IEnumerable<HalfOpenInterval> desiredWindows,
        DateTimeOffset asOf)
    {
        ArgumentNullException.ThrowIfNull(gaps);
        ArgumentNullException.ThrowIfNull(desiredWindows);

        var desired = new List<HalfOpenInterval>();
        foreach (var window in desiredWindows)
        {
            if (window.From < window.To)
            {
                desired.Add(window);
            }
        }

        if (desired.Count == 0)
        {
            return [];
        }

        var clips = new List<HalfOpenInterval>();
        foreach (var (from, to) in gaps)
        {
            var gapTo = to ?? asOf;
            if (from >= gapTo)
            {
                continue;
            }

            foreach (var window in desired)
            {
                var clipFrom = from > window.From ? from : window.From;
                var clipTo = gapTo < window.To ? gapTo : window.To;
                if (clipFrom < clipTo)
                {
                    clips.Add(new HalfOpenInterval(clipFrom, clipTo));
                }
            }
        }

        clips.Sort(static (a, b) => a.From.CompareTo(b.From));
        return clips;
    }
}
