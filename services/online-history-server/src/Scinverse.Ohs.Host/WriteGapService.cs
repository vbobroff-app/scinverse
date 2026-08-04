using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// WriteGap = ScheduleCutter(WriteHole ∩ desired).
/// SoT для Writers Gantt и будущего backfill.
/// </summary>
public sealed class WriteGapService(
    IConnectionStore connections,
    IConnectionScheduleStore schedules,
    ICoverageStore coverage,
    IIncidentStore incidents,
    ITradeBracketStore brackets,
    IMarketCalendar calendar,
    TimeProvider time)
{
    public sealed record Gap(long InstrumentId, short SourceId, DateTimeOffset From, DateTimeOffset To);

    public async Task<IReadOnlyList<Gap>> QueryAsync(
        long connectionId,
        DateTimeOffset from,
        DateTimeOffset to,
        IReadOnlyList<long> instrumentIds,
        CancellationToken cancellationToken)
    {
        if (instrumentIds.Count == 0 || from >= to)
        {
            return [];
        }

        var connection = await connections.GetAsync(connectionId, cancellationToken).ConfigureAwait(false);
        if (connection is null)
        {
            return [];
        }

        var sourceId = connection.SourceId;
        var asOf = time.GetUtcNow();
        var rangeTo = to < asOf ? to : asOf;

        var state = await schedules.GetStateAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var desired = await EnumerateDesiredAsync(state, from, rangeTo, cancellationToken)
            .ConfigureAwait(false);
        if (desired.Count == 0)
        {
            return [];
        }

        var ids = instrumentIds.Distinct().ToArray();
        var segments = await coverage.QuerySegmentsAsync(from, to, cancellationToken).ConfigureAwait(false);
        var byInstrument = segments
            .Where(s => s.SourceId == sourceId && ids.Contains(s.InstrumentId))
            .GroupBy(s => s.InstrumentId)
            .ToDictionary(g => g.Key, g => g.ToList());

        var incidentPage = await incidents.QueryAsync(
            new IncidentQuery
            {
                Module = "connection",
                ConnectionId = connectionId,
                From = from,
                To = to,
                Limit = 1000,
                IncludeDeleted = false,
            },
            cancellationToken).ConfigureAwait(false);

        var incidentSpans = incidentPage.Items
            .Select(i => (i.OpenedAt, i.ClosedAt))
            .ToList();
        if (incidentSpans.Count == 0)
        {
            return [];
        }

        // Bracketing по окну Ганта; intention = envelope сегментов (не каждый кусок отдельно).
        var bracketFrom = from;
        var bracketTo = rangeTo;

        var cores = new List<WriteHoleBuilder.Core>();
        foreach (var instrumentId in ids)
        {
            if (!byInstrument.TryGetValue(instrumentId, out var segs) || segs.Count == 0)
            {
                continue;
            }

            var envFrom = segs.Min(s => s.StartedAt);
            var envTo = segs.Max(s => s.EndedAt ?? asOf);
            if (envTo > asOf)
            {
                envTo = asOf;
            }

            // Одно окно записи: crash между сегментами всё ещё ∩ envelope.
            var intentions = new[] { (envFrom, (DateTimeOffset?)envTo) };
            foreach (var core in WriteHoleBuilder.BuildCores(instrumentId, intentions, incidentSpans, asOf))
            {
                cores.Add(core with
                {
                    IntentionFrom = bracketFrom < core.IntentionFrom ? bracketFrom : core.IntentionFrom,
                    IntentionTo = bracketTo > core.IntentionTo ? bracketTo : core.IntentionTo,
                });
            }
        }

        if (cores.Count == 0)
        {
            return [];
        }

        var requests = cores
            .Select(c => new TradeBracketRequest(
                c.InstrumentId, bracketFrom, c.CoreFrom, c.CoreTo, bracketTo))
            .ToList();
        var bracketRows = await brackets
            .QueryBracketsAsync(sourceId, requests, cancellationToken)
            .ConfigureAwait(false);
        // unnest сохраняет порядок запросов → zip по индексу (не по DateTimeOffset-ключу).
        if (bracketRows.Count != cores.Count)
        {
            throw new InvalidOperationException(
                $"TradeBracketStore returned {bracketRows.Count} rows for {cores.Count} cores.");
        }

        var holesByInstrument = new Dictionary<long, List<HalfOpenInterval>>();
        for (var i = 0; i < cores.Count; i++)
        {
            var core = cores[i];
            var bracket = bracketRows[i];
            var hole = WriteHoleBuilder.Expand(
                core, bracket.LastBefore, bracket.FirstAfter, asOf);
            if (hole is not { } h)
            {
                continue;
            }

            if (!holesByInstrument.TryGetValue(core.InstrumentId, out var list))
            {
                list = [];
                holesByInstrument[core.InstrumentId] = list;
            }

            list.Add(h);
        }

        var gaps = new List<Gap>();
        foreach (var (instrumentId, holes) in holesByInstrument)
        {
            var merged = WriteHoleBuilder.Merge(holes);
            var cut = ScheduleCutter.Cut(
                merged.Select(h => (h.From, (DateTimeOffset?)h.To)),
                desired,
                asOf);
            foreach (var clip in cut)
            {
                gaps.Add(new Gap(instrumentId, sourceId, clip.From, clip.To));
            }
        }

        gaps.Sort(static (a, b) =>
        {
            var byInst = a.InstrumentId.CompareTo(b.InstrumentId);
            return byInst != 0 ? byInst : a.From.CompareTo(b.From);
        });
        return gaps;
    }

    private async Task<IReadOnlyList<HalfOpenInterval>> EnumerateDesiredAsync(
        ConnectionScheduleState state,
        DateTimeOffset from,
        DateTimeOffset to,
        CancellationToken cancellationToken)
    {
        var settings = state.Settings;
        var zone = ResolveZone(settings.Tz);
        var localFrom = TimeZoneInfo.ConvertTime(from, zone);
        var localTo = TimeZoneInfo.ConvertTime(to, zone);
        var startDay = DateOnly.FromDateTime(localFrom.DateTime).AddDays(-1);
        var endDay = DateOnly.FromDateTime(localTo.DateTime);

        var days = new List<DateOnly>();
        for (var day = startDay; day <= endDay; day = day.AddDays(1))
        {
            days.Add(day);
        }

        var sessions = days.Count == 0
            ? []
            : await calendar.ShapeSessionsAsync(settings.Engine, days, cancellationToken)
                .ConfigureAwait(false);
        var trading = sessions.Select(s => s.Date).ToHashSet();

        return DesiredWindowEnumerator.Enumerate(
            state.LiveRules,
            settings.Engine,
            settings.Tz,
            from,
            to,
            (_, day) => trading.Contains(day));
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
}
