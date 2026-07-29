namespace Scinverse.Ohs.Domain;

/// <summary>
/// Политика владения break (7j.20): жёлтая фаза TRANSAQ длится <c>t ≤ T</c>
/// (T = max; раньше — при Degraded→Down). Catch-up — только если close после T без маркера.
/// </summary>
public static class LinkOwnership
{
    /// <summary>
    /// Потолок T: owner ещё <c>transaq</c> и elapsed ≥ T, маркера не было —
    /// boundary на <c>since+T</c>. Early fail пишет маркер раньше (не сюда).
    /// </summary>
    public static DateTimeOffset? CatchUpEscalationAt(
        string owner, DateTimeOffset incidentStart, DateTimeOffset atTs, TimeSpan grace)
    {
        if (!string.Equals(owner, "transaq", StringComparison.Ordinal)
            || grace <= TimeSpan.Zero
            || atTs - incidentStart < grace)
        {
            return null;
        }

        return incidentStart + grace;
    }
}
