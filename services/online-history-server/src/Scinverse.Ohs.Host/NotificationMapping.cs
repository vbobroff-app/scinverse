using System.Text.Json;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>Маппинг между live-DTO хаба и строкой аудит-лога (<see cref="NotificationRecord"/>).</summary>
public static class NotificationMapping
{
    public static NotificationRecord ToRecord(NotificationDto e) => new()
    {
        EventId = Guid.ParseExact(e.Id, "N"),
        Ts = e.Ts,
        Severity = e.Severity,
        SourceType = e.SourceType,
        Interaction = e.Interaction,
        Localization = e.Localization,
        Status = e.Status,
        Module = e.Module,
        Code = e.Code,
        Message = e.Message,
        Subject = e.Subject,
        CorrelationId = e.CorrelationId,
        ActorKind = e.ActorKind,
        ActorId = e.ActorId,
        ActorLabel = e.ActorLabel,
        Data = e.Data?.GetRawText(),
    };

    public static NotificationDto ToDto(NotificationRecord r) => new(
        Id: r.EventId.ToString("N"),
        Ts: r.Ts,
        Severity: r.Severity,
        SourceType: r.SourceType,
        Module: r.Module,
        Code: r.Code,
        Message: r.Message,
        Status: r.Status,
        CorrelationId: r.CorrelationId,
        Data: r.Data is null ? null : JsonSerializer.Deserialize<JsonElement>(r.Data),
        Interaction: r.Interaction,
        Localization: r.Localization,
        ActorKind: r.ActorKind,
        ActorId: r.ActorId,
        ActorLabel: r.ActorLabel,
        Subject: r.Subject);
}
