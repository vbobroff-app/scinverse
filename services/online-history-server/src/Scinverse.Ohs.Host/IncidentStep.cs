namespace Scinverse.Ohs.Host;

/// <summary>
/// Один шаг жизненного цикла инцидента (I2). Один DTO → fan-out в journal + NC.
/// </summary>
public enum IncidentStepKind
{
    Open,
    Handover,
    Recovering,
    /// <summary>
    /// Auto ×N исчерпан / ждём оператора: journal <c>recovering → active</c>
    /// (как NC threadStatus после финального <c>connect_failed</c> status=active).
    /// </summary>
    AwaitOperator,
    Resolve,
    CrashOpen,
    Adopt,
}

/// <summary>
/// Канонический шаг эпизода: одинаковые <c>corr</c> / <c>at</c> / outcome для
/// <c>incident</c> и атомов Hub/NC. Форма NC (code/message/data) опциональна — journal-only
/// шаги (handover) допустимы.
/// </summary>
public sealed record IncidentStep(
    IncidentStepKind Kind,
    string Subject,
    DateTimeOffset At,
    string? CorrUid = null,
    long? ConnectionId = null,
    short? SourceId = null,
    string? Owner = null,
    string? Subtype = null,
    string? Title = null,
    string? CloseOutcome = null,
    string? Severity = null,
    string? ResolvedBy = null,
    /// <summary>Hub status при Adopt: <c>active</c> / <c>underway</c>.</summary>
    string? HubStatus = null,
    string? NcCode = null,
    string? NcMessage = null,
    string? NcSeverity = null,
    object? NcData = null,
    /// <summary>
    /// true — не писать journal (NC уже/отдельно; напр. manual resolve после жёсткого
    /// <c>IIncidentStore.ResolveAsync</c>, когда SafeAsync недопустим).
    /// </summary>
    bool SkipJournal = false);
