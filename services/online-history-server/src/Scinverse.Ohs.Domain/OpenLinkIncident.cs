namespace Scinverse.Ohs.Domain;

/// <summary>
/// Открытый break (<c>connection:{id}:link:{uid}</c>) для adopt в память Hub/Manager (I10/I13).
/// SoT — журнал <c>incident</c>; NC/Hub — только session seed после adopt.
/// </summary>
public sealed record OpenLinkIncident(
    string CorrelationId,
    string Status,
    DateTimeOffset OpenedAt)
{
    public static OpenLinkIncident FromJournal(Incident row) =>
        new(
            row.CorrUid,
            row.Status is "recovering" ? "underway" : "active",
            row.OpenedAt);
}
