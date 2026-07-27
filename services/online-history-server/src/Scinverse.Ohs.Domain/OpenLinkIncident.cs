namespace Scinverse.Ohs.Domain;

/// <summary>
/// Открытый break-инцидент связи в аудите V025 (<c>connection:{id}:link:{uid}</c> без terminal).
/// После рестарта Host — источник adopt в память Hub/Manager (7j I10).
/// </summary>
public sealed record OpenLinkIncident(
    string CorrelationId,
    string Status,
    DateTimeOffset OpenedAt);
