using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// J4 (scoped): gaps <c>link_liveness</c> за вчера+сегодня (МСК) → строки журнала <c>incident</c>.
/// Не полная история; forward + open-adopt остаются отдельно.
/// </summary>
public static class IncidentRecentBackfill
{
    /// <summary>[startOfYesterday MSK, nowUtc] в UTC.</summary>
    public static (DateTimeOffset FromUtc, DateTimeOffset ToUtc) WindowUtc(DateTimeOffset nowUtc)
    {
        var msk = nowUtc.ToOffset(MoexSchedule.MoscowOffset);
        var today = DateOnly.FromDateTime(msk.DateTime);
        var yesterday = today.AddDays(-1);
        var fromMsk = new DateTimeOffset(yesterday.ToDateTime(TimeOnly.MinValue), MoexSchedule.MoscowOffset);
        return (fromMsk.ToUniversalTime(), nowUtc.ToUniversalTime());
    }

    public static bool IsIncidentCause(LinkCloseReason cause) =>
        cause is LinkCloseReason.Degraded
            or LinkCloseReason.ServerDown
            or LinkCloseReason.PingFailed
            or LinkCloseReason.Interrupted;

    /// <summary>Стабильный corr для идемпотентного INSERT (не путать с live Hub corr).</summary>
    public static string CorrUid(long connectionId, DateTimeOffset openedAt) =>
        $"connection:{connectionId}:link:gapbf:{openedAt.ToUnixTimeMilliseconds()}";

    public static bool OverlapsExisting(IReadOnlyList<Incident> existing, LinkGap gap)
    {
        var gapTo = gap.To ?? DateTimeOffset.MaxValue;
        foreach (var row in existing)
        {
            var rowTo = row.ClosedAt ?? DateTimeOffset.MaxValue;
            if (row.OpenedAt < gapTo && rowTo > gap.From)
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>null — не инцидент (серое) или вне окна.</summary>
    public static Incident? TryMap(
        long connectionId,
        LinkGap gap,
        DateTimeOffset windowFromUtc,
        DateTimeOffset windowToUtc)
    {
        if (!IsIncidentCause(gap.Cause))
        {
            return null;
        }

        if (gap.From >= windowToUtc)
        {
            return null;
        }

        if (gap.To is { } closed && closed <= windowFromUtc)
        {
            return null;
        }

        var isCrash = gap.Cause == LinkCloseReason.Interrupted;
        var (owner, subtype) = ResolveOwnerSubtype(gap);
        var openedAt = gap.From.ToUniversalTime();
        var closedAt = gap.To?.ToUniversalTime();
        var resolved = closedAt is not null;
        var closeOutcome = resolved
            ? (gap.Abandoned
                ? NotificationThreadData.OutcomeAbandonedSchedule
                : NotificationThreadData.OutcomeRecovered)
            : null;

        return new Incident
        {
            CorrUid = CorrUid(connectionId, openedAt),
            Module = "connection",
            Type = isCrash ? "crash" : "break",
            Status = resolved ? "resolved" : "active",
            CloseOutcome = closeOutcome,
            OpenedAt = openedAt,
            ClosedAt = closedAt,
            Subject = ConnectionManager.LinkIncidentSubject(connectionId),
            Severity = isCrash ? "critical" : "error",
            Title = isCrash
                ? "backfill: прерывание связи (краш/рестарт)"
                : "backfill: разрыв связи",
            LastActivityAt = closedAt ?? openedAt,
            ConnectionId = connectionId,
            SourceId = gap.SourceId,
            EscalatedAt = gap.EscalatedAt?.ToUniversalTime(),
            Subtype = subtype,
            Owner = owner,
            Payload = """{"source":"gap_backfill"}""",
        };
    }

    private static (string Owner, string Subtype) ResolveOwnerSubtype(LinkGap gap)
    {
        if (gap.Cause == LinkCloseReason.Interrupted)
        {
            return ("admin", "host_unavailable");
        }

        if (gap.EscalatedAt is not null)
        {
            return ("supervisor", "down");
        }

        if (gap.Cause == LinkCloseReason.Degraded)
        {
            return ("transaq", "degraded");
        }

        return ("supervisor", "down");
    }
}
