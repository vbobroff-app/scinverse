namespace Scinverse.Ohs.Domain;

/// <summary>
/// Абсолютные desired-окна connection поверх <see cref="ConnectionScheduleResolver"/>.
/// Та же семантика, что Auto (date &gt; dow &gt; main + trading-day для main).
/// </summary>
public static class DesiredWindowEnumerator
{
    /// <summary>
    /// Окна сессий, пересекающие <c>[rangeFrom, rangeTo)</c>, в UTC (offset нуля).
    /// Пустые live-rules → [].
    /// </summary>
    public static IReadOnlyList<HalfOpenInterval> Enumerate(
        IReadOnlyCollection<ConnectionScheduleRule> liveRules,
        string engine,
        string tz,
        DateTimeOffset rangeFrom,
        DateTimeOffset rangeTo,
        ConnectionScheduleResolver.TradingDayLookup isTradingDay)
    {
        ArgumentNullException.ThrowIfNull(liveRules);
        ArgumentNullException.ThrowIfNull(isTradingDay);

        if (liveRules.Count == 0 || rangeFrom >= rangeTo)
        {
            return [];
        }

        var zone = ResolveZone(tz);
        var localFrom = TimeZoneInfo.ConvertTime(rangeFrom, zone);
        var localTo = TimeZoneInfo.ConvertTime(rangeTo, zone);

        // Дни открытия: сутки до локального from … сутки локального to (overnight tail).
        var startDay = DateOnly.FromDateTime(localFrom.DateTime).AddDays(-1);
        var endDay = DateOnly.FromDateTime(localTo.DateTime);

        var raw = new List<HalfOpenInterval>();
        for (var day = startDay; day <= endDay; day = day.AddDays(1))
        {
            if (ConnectionScheduleResolver.ResolveSession(liveRules, engine, day, isTradingDay)
                is not { } session)
            {
                continue;
            }

            var openLocal = new DateTimeOffset(
                day.ToDateTime(session.Open, DateTimeKind.Unspecified),
                GetUtcOffset(zone, day, session.Open));
            var fromUtc = openLocal.ToUniversalTime();
            var toUtc = fromUtc.AddMinutes(session.DurationMin);

            var clipFrom = fromUtc > rangeFrom.ToUniversalTime() ? fromUtc : rangeFrom.ToUniversalTime();
            var clipTo = toUtc < rangeTo.ToUniversalTime() ? toUtc : rangeTo.ToUniversalTime();
            if (clipFrom < clipTo)
            {
                raw.Add(new HalfOpenInterval(clipFrom, clipTo));
            }
        }

        return Merge(raw);
    }

    private static List<HalfOpenInterval> Merge(List<HalfOpenInterval> intervals)
    {
        if (intervals.Count == 0)
        {
            return [];
        }

        intervals.Sort(static (a, b) => a.From.CompareTo(b.From));
        var merged = new List<HalfOpenInterval>(intervals.Count) { intervals[0] };
        for (var i = 1; i < intervals.Count; i++)
        {
            var cur = intervals[i];
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

    private static TimeZoneInfo ResolveZone(string tz)
    {
        if (string.Equals(tz, "Europe/Moscow", StringComparison.OrdinalIgnoreCase)
            || string.Equals(tz, "MSK", StringComparison.OrdinalIgnoreCase))
        {
            return TimeZoneInfo.CreateCustomTimeZone(
                "Europe/Moscow", MoexSchedule.MoscowOffset, "MSK", "MSK");
        }

        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(tz);
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.CreateCustomTimeZone(
                "Europe/Moscow", MoexSchedule.MoscowOffset, "MSK", "MSK");
        }
        catch (InvalidTimeZoneException)
        {
            return TimeZoneInfo.CreateCustomTimeZone(
                "Europe/Moscow", MoexSchedule.MoscowOffset, "MSK", "MSK");
        }
    }

    private static TimeSpan GetUtcOffset(TimeZoneInfo zone, DateOnly day, TimeOnly time)
    {
        var unspecified = day.ToDateTime(time, DateTimeKind.Unspecified);
        return zone.GetUtcOffset(unspecified);
    }
}
