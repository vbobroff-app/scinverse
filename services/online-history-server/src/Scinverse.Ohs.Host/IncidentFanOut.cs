using Microsoft.Extensions.Logging;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Fan-out I2: один <see cref="IncidentStep"/> → Hub/NC + <see cref="IJournalRegistrator"/>.
/// Ошибки NC не откатывают journal; journal по-прежнему глотает БД-сбои (SafeAsync).
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
        EmitNcOpen(step);
        var corr = ResolveCorr(step);
        if (corr is null || step.ConnectionId is not { } connectionId)
        {
            return corr;
        }

        await journal
            .RegisterBreakOpenAsync(
                connectionId,
                corr,
                step.At,
                step.Owner ?? "supervisor",
                step.Subtype ?? "down",
                step.SourceId,
                step.Title ?? step.NcMessage ?? "connection.lost",
                cancellationToken)
            .ConfigureAwait(false);
        return corr;
    }

    private async Task<string?> ApplyCrashOpenAsync(IncidentStep step, CancellationToken cancellationToken)
    {
        EmitNcOpen(step);
        var corr = ResolveCorr(step);
        if (corr is null)
        {
            return null;
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
        if (corr is null)
        {
            return null;
        }

        await journal.RegisterBreakHandoverAsync(corr, step.At, cancellationToken).ConfigureAwait(false);
        return corr;
    }

    private async Task<string?> ApplyRecoveringAsync(IncidentStep step, CancellationToken cancellationToken)
    {
        EmitNcProgress(step);
        var corr = ResolveCorr(step);
        if (corr is null)
        {
            return null;
        }

        await journal.RegisterBreakRecoveringAsync(corr, step.At, cancellationToken).ConfigureAwait(false);
        return corr;
    }

    private async Task<string?> ApplyResolveAsync(IncidentStep step, CancellationToken cancellationToken)
    {
        // Corr снимаем до Hub.Resolve — после terminal open в памяти хаба уже нет.
        var corr = ResolveCorr(step);
        EmitNcResolve(step);
        if (corr is null)
        {
            return null;
        }

        await journal
            .RegisterBreakResolvedAsync(
                corr,
                step.At,
                step.CloseOutcome ?? "recovered",
                step.Title,
                step.Severity ?? step.NcSeverity,
                cancellationToken,
                step.ResolvedBy)
            .ConfigureAwait(false);
        return corr;
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

        if (step.ConnectionId is { } connectionId)
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

    private void EmitNcOpen(IncidentStep step)
    {
        if (string.IsNullOrWhiteSpace(step.NcCode))
        {
            return;
        }

        try
        {
            notifications.Open(
                step.Subject,
                step.NcCode,
                step.NcMessage ?? step.Title ?? step.NcCode,
                severity: step.NcSeverity ?? step.Severity ?? "error",
                data: step.NcData);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "IncidentFanOut Open NC failed for {Subject}", step.Subject);
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
                severity: step.NcSeverity ?? step.Severity ?? "warning",
                data: step.NcData);
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
                data: step.NcData);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "IncidentFanOut Resolve NC failed for {Subject}", step.Subject);
        }
    }

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
