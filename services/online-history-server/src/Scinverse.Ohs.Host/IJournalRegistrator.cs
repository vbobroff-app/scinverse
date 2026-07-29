namespace Scinverse.Ohs.Host;

/// <summary>
/// Регистрация строк журнала <c>incident</c> (phase 11.13b). Не путать с TradeWriter (сделки)
/// и с Recording-лентой (бинарная проекция чтения).
/// </summary>
public interface IJournalRegistrator
{
    /// <summary>Open break (module=connection, type=break).</summary>
    Task RegisterBreakOpenAsync(
        long connectionId,
        string corrUid,
        DateTimeOffset openedAt,
        string owner,
        string subtype,
        short? sourceId,
        string title,
        CancellationToken cancellationToken);

    /// <summary>Handover TRANSAQ→supervisor: escalated_at + owner/subtype.</summary>
    Task RegisterBreakHandoverAsync(
        string corrUid,
        DateTimeOffset escalatedAt,
        CancellationToken cancellationToken);

    /// <summary>Фаза восстановления (status=recovering).</summary>
    Task RegisterBreakRecoveringAsync(
        string corrUid,
        DateTimeOffset at,
        CancellationToken cancellationToken);

    /// <summary>Terminal close (recovered / abandoned_*).</summary>
    Task RegisterBreakResolvedAsync(
        string corrUid,
        DateTimeOffset closedAt,
        string closeOutcome,
        string? title,
        string? severity,
        CancellationToken cancellationToken);

    /// <summary>
    /// Adopt после рестарта: строка уже должна быть в журнале (из прошлого Open).
    /// Если нет — INSERT open (backfill), чтобы Resolve/лента не потеряли corr.
    /// </summary>
    Task EnsureBreakAdoptedAsync(
        long connectionId,
        string corrUid,
        DateTimeOffset openedAt,
        string hubStatus,
        string owner,
        short? sourceId,
        CancellationToken cancellationToken);
}
