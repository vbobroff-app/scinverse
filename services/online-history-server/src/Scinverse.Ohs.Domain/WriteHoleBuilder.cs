namespace Scinverse.Ohs.Domain;

/// <summary>
/// WriteHole = expand(incident ∩ intention) до ближайших сделок (<c>md_trade</c>).
/// Чистая геометрия; SoT границ — timestamps сделок, не бакеты.
/// </summary>
public static class WriteHoleBuilder
{
    /// <summary>Ядро дыры до expand: пересечение incident × intention на инструменте.</summary>
    public readonly record struct Core(
        long InstrumentId,
        DateTimeOffset CoreFrom,
        DateTimeOffset CoreTo,
        DateTimeOffset IntentionFrom,
        DateTimeOffset IntentionTo,
        bool IncidentOpen);

    /// <summary>
    /// Строит ядра <c>incident ∩ intention</c>. Открытые концы закрываются в <paramref name="asOf"/>.
    /// Пустые / вырожденные пересечения отбрасываются.
    /// Intention — обычно envelope записи инструмента (min started … max ended), не каждый сегмент
    /// по отдельности: иначе crash между сегментами даёт пустой ∩.
    /// </summary>
    public static IReadOnlyList<Core> BuildCores(
        long instrumentId,
        IEnumerable<(DateTimeOffset From, DateTimeOffset? To)> intentions,
        IEnumerable<(DateTimeOffset From, DateTimeOffset? To)> incidents,
        DateTimeOffset asOf)
    {
        ArgumentNullException.ThrowIfNull(intentions);
        ArgumentNullException.ThrowIfNull(incidents);

        var intentionSpans = NormalizeSpans(intentions, asOf);
        if (intentionSpans.Count == 0)
        {
            return [];
        }

        var cores = new List<Core>();
        foreach (var (incFrom, incTo) in incidents)
        {
            var incidentOpen = incTo is null;
            var incidentTo = incTo ?? asOf;
            if (incFrom >= incidentTo)
            {
                continue;
            }

            foreach (var (intFrom, intTo) in intentionSpans)
            {
                var coreFrom = incFrom > intFrom ? incFrom : intFrom;
                var coreTo = incidentTo < intTo ? incidentTo : intTo;
                if (coreFrom < coreTo)
                {
                    cores.Add(new Core(
                        instrumentId, coreFrom, coreTo, intFrom, intTo, incidentOpen));
                }
            }
        }

        return cores;
    }

    /// <summary>
    /// Expand ядра до last/first trade.
    /// Правый край: <c>firstAfter</c>, иначе для open — <c>min(asOf, intention.to)</c>,
    /// для closed — <c>core.to</c>. Левый: <c>lastBefore ?? core.from</c>.
    /// </summary>
    public static HalfOpenInterval? Expand(
        Core core,
        DateTimeOffset? lastTradeBefore,
        DateTimeOffset? firstTradeAfter,
        DateTimeOffset asOf)
    {
        var from = lastTradeBefore ?? core.CoreFrom;
        if (from < core.IntentionFrom)
        {
            from = core.IntentionFrom;
        }

        // Правый край: first trade после ядра — SoT (не режем closed_at / segment end).
        // Cap только окном intention/asOf, чтобы не уехать в будущее.
        var hardCap = asOf < core.IntentionTo ? asOf : core.IntentionTo;
        DateTimeOffset to;
        if (firstTradeAfter is { } fa)
        {
            to = fa < hardCap ? fa : hardCap;
        }
        else if (core.IncidentOpen)
        {
            to = hardCap;
        }
        else
        {
            // Нет сделки после closed_at — дыра до закрытия инцидента (в пределах окна).
            to = core.CoreTo < hardCap ? core.CoreTo : hardCap;
        }

        if (from >= to)
        {
            return null;
        }

        return new HalfOpenInterval(from, to);
    }

    /// <summary>Сливает перекрывающиеся / смежные полуоткрытые интервалы (по возрастанию From).</summary>
    public static IReadOnlyList<HalfOpenInterval> Merge(IEnumerable<HalfOpenInterval> holes)
    {
        ArgumentNullException.ThrowIfNull(holes);

        var list = holes.Where(h => h.From < h.To).OrderBy(h => h.From).ToList();
        if (list.Count == 0)
        {
            return [];
        }

        var merged = new List<HalfOpenInterval>(list.Count) { list[0] };
        for (var i = 1; i < list.Count; i++)
        {
            var cur = list[i];
            var last = merged[^1];
            if (cur.From <= last.To)
            {
                var to = cur.To > last.To ? cur.To : last.To;
                merged[^1] = new HalfOpenInterval(last.From, to);
            }
            else
            {
                merged.Add(cur);
            }
        }

        return merged;
    }

    private static List<(DateTimeOffset From, DateTimeOffset To)> NormalizeSpans(
        IEnumerable<(DateTimeOffset From, DateTimeOffset? To)> spans,
        DateTimeOffset asOf)
    {
        var result = new List<(DateTimeOffset From, DateTimeOffset To)>();
        foreach (var (from, to) in spans)
        {
            var end = to ?? asOf;
            if (from < end)
            {
                result.Add((from, end));
            }
        }

        return result;
    }
}
