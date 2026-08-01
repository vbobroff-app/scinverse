using Microsoft.Extensions.Logging;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Fan-out I2/I13: один <see cref="IncidentStep"/> → journal (SoT) + Hub/NC (зеркало).
/// Отказ NC не откатывает journal; corr мантится до Hub, не читается из notification-таблицы.
/// </summary>
public sealed class IncidentFanOut(
    INotificationPublisher notifications,
    IJournalRegistrator journal,
    ILogger<IncidentFanOut> logger) : IIncidentFanOut
{
    public async Task<string?> ApplyAsync(IncidentStep step, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(step);
        if (string.IsNullOrWhiteSpace(step.Subject))
        {
            throw new ArgumentException("Subject is required.", nameof(step));
        }

        try
        {
            return step.Kind switch
            {
                IncidentStepKind.Open => await ApplyOpenAsync(step, cancellationToken).ConfigureAwait(false),
                IncidentStepKind.CrashOpen => await ApplyCrashOpenAsync(step, cancellationToken).ConfigureAwait(false),
                IncidentStepKind.Handover => await ApplyHandoverAsync(step, cancellationToken).ConfigureAwait(false),
                IncidentStepKind.Recovering => await ApplyRecoveringAsync(step, cancellationToken).ConfigureAwait(false),
                IncidentStepKind.AwaitOperator => await ApplyAwaitOperatorAsync(step, cancellationToken).ConfigureAwait(false),
                IncidentStepKind.Resolve => await ApplyResolveAsync(step, cancellationToken).ConfigureAwait(false),
                IncidentStepKind.Adopt => await ApplyAdoptAsync(step, cancellationToken).ConfigureAwait(false),
                _ => throw new ArgumentOutOfRangeException(nameof(step), step.Kind, "Unknown IncidentStepKind"),
            };
        }
        catch (Exception ex) when (ex is not ArgumentException and not ArgumentOutOfRangeException)
        {
            logger.LogWarning(ex, "IncidentFanOut {Kind} failed for subject {Subject}", step.Kind, step.Subject);
            return step.CorrUid;
        }
    }

    private async Task<string?> ApplyOpenAsync(IncidentStep step, CancellationToken cancellationToken)
    {
        var corr = EnsureCorr(step);

        if (!string.IsNullOrWhiteSpace(step.NcCode))
        {
            var hubOpened = EmitNcOpen(step, corr);
            if (!hubOpened)
            {
                // Subject уже open в Hub — тот же corr (не плодим второй journal).
                if (notifications.TryGetOpenCorrelationId(step.Subject, out var existing)
                    && !string.IsNullOrWhiteSpace(existing))
                {
                    corr = existing!;
                    if (!step.SkipJournal && step.ConnectionId is { } reuseId)
                    {
                        await journal
                            .EnsureBreakAdoptedAsync(
                                reuseId,
                                corr,
                                step.At,
                                hubStatus: "active",
                                step.Owner ?? "supervisor",
                                step.SourceId,
                                cancellationToken)
                            .ConfigureAwait(false);
                    }

                    return corr;
                }

                // NC недоступен / Open упал — journal всё равно пишем (I13).
                logger.LogWarning(
                    "IncidentFanOut Open NC failed for {Subject}; journal proceeds with {CorrUid}",
                    step.Subject,
                    corr);
            }
        }

        if (step.SkipJournal || step.ConnectionId is not { } connectionId)
        {
            return corr;
        }

        // WS уже в EmitNcOpen. Journal в фоне: иначе ConfirmDegraded ждёт пул БД до TryAdd
        // _incidentSince → Live успевает CloseIncident(no-op) → залипший ACTIVE при синем тумблере.
        _ = journal.RegisterBreakOpenAsync(
            connectionId,
            corr,
            step.At,
            step.Owner ?? "supervisor",
            step.Subtype ?? "down",
            step.SourceId,
            step.Title ?? step.NcMessage ?? "connection.lost",
            cancellationToken);
        return corr;
    }

    private async Task<string?> ApplyCrashOpenAsync(IncidentStep step, CancellationToken cancellationToken)
    {
        var corr = EnsureCorr(step);

        if (!string.IsNullOrWhiteSpace(step.NcCode))
        {
            var hubOpened = EmitNcOpen(step, corr);
            if (!hubOpened)
            {
                if (notifications.TryGetOpenCorrelationId(step.Subject, out var existing)
                    && !string.IsNullOrWhiteSpace(existing))
                {
                    return existing;
                }

                logger.LogWarning(
                    "IncidentFanOut CrashOpen NC failed for {Subject}; journal proceeds with {CorrUid}",
                    step.Subject,
                    corr);
            }
        }

        if (step.SkipJournal)
        {
            return corr;
        }

        await journal
            .RegisterCrashOpenAsync(
                corr,
                step.At,
                step.ConnectionId,
                step.Title ?? step.NcMessage ?? "Система недоступна",
                cancellationToken)
            .ConfigureAwait(false);
        return corr;
    }

    private async Task<string?> ApplyHandoverAsync(IncidentStep step, CancellationToken cancellationToken)
    {
        EmitNcProgress(step);
        var corr = ResolveCorr(step);
        if (step.SkipJournal || corr is null)
        {
            return corr;
        }

        await journal.RegisterBreakHandoverAsync(corr, step.At, cancellationToken).ConfigureAwait(false);
        return corr;
    }

    private async Task<string?> ApplyRecoveringAsync(IncidentStep step, CancellationToken cancellationToken)
    {
        EmitNcProgress(step);
        var corr = ResolveCorr(step);
        if (step.SkipJournal || corr is null)
        {
            return corr;
        }

        await journal.RegisterBreakRecoveringAsync(corr, step.At, cancellationToken).ConfigureAwait(false);
        return corr;
    }

    private async Task<string?> ApplyAwaitOperatorAsync(IncidentStep step, CancellationToken cancellationToken)
    {
        // NC уже пишет финальный connect_failed status=active / auto_stopped — journal-only.
        EmitNcProgress(step);
        var corr = ResolveCorr(step);
        if (step.SkipJournal || corr is null)
        {
            return corr;
        }

        await journal.RegisterBreakAwaitOperatorAsync(corr, step.At, cancellationToken).ConfigureAwait(false);
        return corr;
    }

    private async Task<string?> ApplyResolveAsync(IncidentStep step, CancellationToken cancellationToken)
    {
        // Corr снимаем до Hub.Resolve — после terminal open в памяти хаба уже нет.
        var corr = ResolveCorr(step);
        // WS recovered/closed ДО journal (как open) — но journal ждём: иначе CrashOpen
        // успевает вставить active, пока resolve крутится в фоне.
        EmitNcResolve(step);
        if (step.SkipJournal || corr is null)
        {
            return corr;
        }

        await CompleteResolveJournalAsync(step, corr, cancellationToken).ConfigureAwait(false);
        return corr;
    }

    private async Task CompleteResolveJournalAsync(
        IncidentStep step, string corrUid, CancellationToken cancellationToken)
    {
        await journal
            .RegisterBreakResolvedAsync(
                corrUid,
                step.At,
                step.CloseOutcome ?? "recovered",
                step.Title,
                step.Severity ?? step.NcSeverity,
                cancellationToken,
                step.ResolvedBy)
            .ConfigureAwait(false);
        if (step.ConnectionId is { } connectionId)
        {
            await journal
                .BindConnectionIdIfNullAsync(corrUid, connectionId, cancellationToken)
                .ConfigureAwait(false);
        }
    }

    private async Task<string?> ApplyAdoptAsync(IncidentStep step, CancellationToken cancellationToken)
    {
        var corr = step.CorrUid;
        if (corr is null)
        {
            return null;
        }

        var hubStatus = step.HubStatus is "underway" or "recovering" ? "underway" : "active";
        try
        {
            notifications.Adopt(step.Subject, corr, hubStatus);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "IncidentFanOut Adopt NC failed for {CorrUid}", corr);
        }

        if (!step.SkipJournal && step.ConnectionId is { } connectionId)
        {
            await journal
                .EnsureBreakAdoptedAsync(
                    connectionId,
                    corr,
                    step.At,
                    hubStatus,
                    step.Owner ?? "supervisor",
                    step.SourceId,
                    cancellationToken)
                .ConfigureAwait(false);
        }

        return corr;
    }

    /// <returns><c>false</c> — Hub отказал (subject уже open) или исключение.</returns>
    private bool EmitNcOpen(IncidentStep step, string corrUid)
    {
        if (string.IsNullOrWhiteSpace(step.NcCode))
        {
            return true;
        }

        try
        {
            var opened = notifications.Open(
                step.Subject,
                step.NcCode,
                step.NcMessage ?? step.Title ?? step.NcCode,
                severity: step.NcSeverity ?? step.Severity ?? "error",
                data: step.NcData,
                ts: step.At,
                correlationId: corrUid);
            if (!opened)
            {
                logger.LogWarning(
                    "IncidentFanOut: Hub.Open refused (subject already open) {Subject}",
                    step.Subject);
            }

            return opened;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "IncidentFanOut Open NC failed for {Subject}", step.Subject);
            return false;
        }
    }

    private void EmitNcProgress(IncidentStep step)
    {
        if (string.IsNullOrWhiteSpace(step.NcCode))
        {
            return;
        }

        try
        {
            notifications.Progress(
                step.Subject,
                step.NcCode,
                step.NcMessage ?? step.Title ?? step.NcCode,
                severity: step.NcSeverity ?? step.Severity ?? "info",
                data: step.NcData,
                ts: step.At);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "IncidentFanOut Progress NC failed for {Subject}", step.Subject);
        }
    }

    private void EmitNcResolve(IncidentStep step)
    {
        if (string.IsNullOrWhiteSpace(step.NcCode))
        {
            return;
        }

        try
        {
            notifications.Resolve(
                step.Subject,
                step.NcCode,
                step.NcMessage ?? step.Title ?? step.NcCode,
                severity: step.NcSeverity ?? step.Severity ?? "ok",
                data: step.NcData,
                ts: step.At);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "IncidentFanOut Resolve NC failed for {Subject}", step.Subject);
        }
    }

    private static string EnsureCorr(IncidentStep step) =>
        !string.IsNullOrWhiteSpace(step.CorrUid)
            ? step.CorrUid!
            : $"{step.Subject}:{Guid.NewGuid().ToString("N")[..8]}";

    /// <summary>
    /// Corr для mid-life шагов: явный → Hub session (после adopt/open) → null.
    /// Hub здесь — in-memory session, не durable SoT.
    /// </summary>
    private string? ResolveCorr(IncidentStep step)
    {
        if (!string.IsNullOrWhiteSpace(step.CorrUid))
        {
            return step.CorrUid;
        }

        return notifications.TryGetOpenCorrelationId(step.Subject, out var corr) ? corr : null;
    }
}

/// <summary>No-op для unit-тестов без fan-out.</summary>
public sealed class NullIncidentFanOut : IIncidentFanOut
{
    public static NullIncidentFanOut Instance { get; } = new();

    public Task<string?> ApplyAsync(IncidentStep step, CancellationToken cancellationToken = default) =>
        Task.FromResult(step.CorrUid);
}
