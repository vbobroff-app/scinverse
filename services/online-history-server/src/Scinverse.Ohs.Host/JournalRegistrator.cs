using System.Collections.Concurrent;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Персист журнала инцидентов через <see cref="IIncidentStore"/>.
/// Ошибки БД не роняют control-plane: лог + Single system·error в NC (не новый Incident).
/// </summary>
public sealed class JournalRegistrator(
    IIncidentStore store,
    INotificationPublisher notifications,
    ILogger<JournalRegistrator> logger) : IJournalRegistrator
{
    /// <summary>Дедуп NC: одинаковая ошибка на corr+op не спамит.</summary>
    private readonly ConcurrentDictionary<string, string> _lastError = new(StringComparer.Ordinal);
    public Task RegisterBreakOpenAsync(
        long connectionId,
        string corrUid,
        DateTimeOffset openedAt,
        string owner,
        string subtype,
        short? sourceId,
        string title,
        CancellationToken cancellationToken) =>
        SafeAsync(
            corrUid,
            "open",
            () => store.OpenAsync(
                new Incident
                {
                    CorrUid = corrUid,
                    Module = "connection",
                    Type = "break",
                    Status = "active",
                    OpenedAt = openedAt,
                    Subject = ConnectionManager.LinkIncidentSubject(connectionId),
                    Severity = "error",
                    Title = title,
                    LastActivityAt = openedAt,
                    ConnectionId = connectionId,
                    SourceId = sourceId,
                    Subtype = subtype,
                    Owner = owner,
                },
                cancellationToken));

    public Task RegisterBreakHandoverAsync(
        string corrUid,
        DateTimeOffset escalatedAt,
        CancellationToken cancellationToken) =>
        SafeAsync(
            corrUid,
            "handover",
            async () =>
            {
                var existing = await store.GetAsync(corrUid, cancellationToken).ConfigureAwait(false);
                if (existing is null || existing.Status is "resolved")
                {
                    return false;
                }

                return await store.UpdateOpenAsync(
                        existing with
                        {
                            Status = existing.Status == "recovering" ? "recovering" : "active",
                            EscalatedAt = existing.EscalatedAt ?? escalatedAt,
                            Owner = "supervisor",
                            Subtype = "down",
                            LastActivityAt = escalatedAt,
                        },
                        cancellationToken)
                    .ConfigureAwait(false);
            });

    public Task RegisterBreakRecoveringAsync(
        string corrUid,
        DateTimeOffset at,
        CancellationToken cancellationToken) =>
        SafeAsync(
            corrUid,
            "recovering",
            async () =>
            {
                var existing = await store.GetAsync(corrUid, cancellationToken).ConfigureAwait(false);
                if (existing is null || existing.Status is "resolved")
                {
                    return false;
                }

                return await store.UpdateOpenAsync(
                        existing with
                        {
                            Status = "recovering",
                            LastActivityAt = at,
                        },
                        cancellationToken)
                    .ConfigureAwait(false);
            });

    public Task RegisterBreakAwaitOperatorAsync(
        string corrUid,
        DateTimeOffset at,
        CancellationToken cancellationToken) =>
        SafeAsync(
            corrUid,
            "await-operator",
            async () =>
            {
                var existing = await store.GetAsync(corrUid, cancellationToken).ConfigureAwait(false);
                if (existing is null || existing.Status is "resolved")
                {
                    return false;
                }

                if (existing.Status == "active")
                {
                    return true;
                }

                return await store.UpdateOpenAsync(
                        existing with
                        {
                            Status = "active",
                            LastActivityAt = at,
                        },
                        cancellationToken)
                    .ConfigureAwait(false);
            });

    public Task RegisterBreakResolvedAsync(
        string corrUid,
        DateTimeOffset closedAt,
        string closeOutcome,
        string? title,
        string? severity,
        CancellationToken cancellationToken,
        string? resolvedBy = null) =>
        SafeAsync(
            corrUid,
            "resolve",
            async () =>
            {
                if (await store
                        .ResolveAsync(
                            corrUid, closedAt, closeOutcome, title, severity, resolvedBy, cancellationToken)
                        .ConfigureAwait(false))
                {
                    return true;
                }

                var isCrash = corrUid.StartsWith("ohs.backend.outage:", StringComparison.Ordinal);
                Incident Terminal() => new()
                {
                    CorrUid = corrUid,
                    Module = "connection",
                    Type = isCrash ? "crash" : "break",
                    Status = "resolved",
                    CloseOutcome = closeOutcome,
                    OpenedAt = closedAt,
                    ClosedAt = closedAt,
                    Subject = SubjectFromCorr(corrUid),
                    Severity = severity ?? (isCrash ? "ok" : "error"),
                    Title = title ?? (isCrash ? "Система восстановлена" : "Связь восстановлена"),
                    LastActivityAt = closedAt,
                    Subtype = isCrash ? "host_unavailable" : "down",
                    Owner = isCrash ? "admin" : "supervisor",
                };

                // recovered раньше open (FanOut Resolve fire-and-forget): сразу terminal INSERT,
                // иначе CrashOpen успевает вставить active, пока мы крутим Delay.
                if (await store.GetAsync(corrUid, cancellationToken).ConfigureAwait(false) is null)
                {
                    if (await store.OpenAsync(Terminal(), cancellationToken).ConfigureAwait(false))
                    {
                        return true;
                    }

                    // Conflict: parallel CrashOpen уже вставил active → Resolve.
                    if (await store
                            .ResolveAsync(
                                corrUid, closedAt, closeOutcome, title, severity, resolvedBy, cancellationToken)
                            .ConfigureAwait(false))
                    {
                        return true;
                    }
                }

                // Гонка: open ещё в полёте — короткий retry, затем terminal.
                for (var i = 0; i < 10; i++)
                {
                    await Task.Delay(30, cancellationToken).ConfigureAwait(false);
                    if (await store
                            .ResolveAsync(
                                corrUid, closedAt, closeOutcome, title, severity, resolvedBy, cancellationToken)
                            .ConfigureAwait(false))
                    {
                        return true;
                    }
                }

                return await store.OpenAsync(Terminal(), cancellationToken).ConfigureAwait(false);
            });

    /// <summary>Open crash (client-led outage / J8) — module=connection, type=crash.</summary>
    public Task RegisterCrashOpenAsync(
        string corrUid,
        DateTimeOffset openedAt,
        long? connectionId,
        string title,
        CancellationToken cancellationToken) =>
        SafeAsync(
            corrUid,
            "crash-open",
            async () =>
            {
                var inserted = await store.OpenAsync(
                        new Incident
                        {
                            CorrUid = corrUid,
                            Module = "connection",
                            Type = "crash",
                            Status = "active",
                            OpenedAt = openedAt,
                            Subject = SubjectFromCorr(corrUid),
                            Severity = "critical",
                            Title = title,
                            LastActivityAt = openedAt,
                            ConnectionId = connectionId,
                            Subtype = "host_unavailable",
                            Owner = "admin",
                        },
                        cancellationToken)
                    .ConfigureAwait(false);
                // ON CONFLICT DO NOTHING мог оставить null — добьём привязку для ганта Connection.
                if (connectionId is { } id)
                {
                    await store
                        .BindConnectionIdIfNullAsync(corrUid, id, cancellationToken)
                        .ConfigureAwait(false);
                }

                return inserted;
            });

    public Task RegisterCrashOpenWithScopeAsync(
        string corrUid,
        DateTimeOffset openedAt,
        IReadOnlyList<long> connectionIds,
        string title,
        CancellationToken cancellationToken) =>
        SafeAsync(
            corrUid,
            "crash-open-scope",
            async () =>
            {
                await RegisterCrashOpenAsync(corrUid, openedAt, connectionId: null, title, cancellationToken)
                    .ConfigureAwait(false);
                await store
                    .ReplaceConnectionScopeAsync(corrUid, connectionIds, cancellationToken)
                    .ConfigureAwait(false);
                return true;
            });

    public Task BindConnectionIdIfNullAsync(
        string corrUid, long connectionId, CancellationToken cancellationToken) =>
        SafeAsync(
            corrUid,
            "bind-connection",
            () => store.BindConnectionIdIfNullAsync(corrUid, connectionId, cancellationToken));

    private static string SubjectFromCorr(string corrUid)
    {
        // corr = subject:uid — отрезаем последний сегмент.
        var i = corrUid.LastIndexOf(':');
        return i > 0 ? corrUid[..i] : corrUid;
    }

    public Task EnsureBreakAdoptedAsync(
        long connectionId,
        string corrUid,
        DateTimeOffset openedAt,
        string hubStatus,
        string owner,
        short? sourceId,
        CancellationToken cancellationToken) =>
        SafeAsync(
            corrUid,
            "adopt",
            async () =>
            {
                var existing = await store.GetAsync(corrUid, cancellationToken).ConfigureAwait(false);
                if (existing is not null)
                {
                    return true;
                }

                var status = hubStatus is "underway" or "recovering" ? "recovering" : "active";
                return await store.OpenAsync(
                        new Incident
                        {
                            CorrUid = corrUid,
                            Module = "connection",
                            Type = "break",
                            Status = status,
                            OpenedAt = openedAt,
                            Subject = ConnectionManager.LinkIncidentSubject(connectionId),
                            Severity = "error",
                            Title = "adopted open break",
                            LastActivityAt = openedAt,
                            ConnectionId = connectionId,
                            SourceId = sourceId,
                            Subtype = "down",
                            Owner = owner,
                        },
                        cancellationToken)
                    .ConfigureAwait(false);
            });

    private async Task SafeAsync(string corrUid, string op, Func<Task<bool>> action)
    {
        try
        {
            await action().ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "JournalRegistrator {Op} failed for {CorrUid}", op, corrUid);
            PublishJournalFailure(corrUid, op, ex);
        }
    }

    /// <summary>
    /// Single system·error (код не в IsOpenCode — без нового break).
    /// Полный стек остаётся в логе Host.
    /// </summary>
    private void PublishJournalFailure(string corrUid, string op, Exception ex)
    {
        var summary = SummarizeException(ex);
        var key = $"{corrUid}|{op}";
        if (_lastError.TryGetValue(key, out var previous)
            && string.Equals(previous, summary, StringComparison.Ordinal))
        {
            return;
        }

        _lastError[key] = summary;
        try
        {
            notifications.Publish(
                "connection.journal_error",
                $"Журнал инцидентов: сбой {op} ({corrUid}): {summary}",
                severity: "error",
                sourceType: "system",
                data: new
                {
                    corrUid,
                    op,
                    error_message = summary,
                    sender = "backend",
                },
                subject: SubjectFromCorr(corrUid));
        }
        catch (Exception publishEx)
        {
            logger.LogWarning(
                publishEx, "JournalRegistrator: не удалось опубликовать journal_error для {CorrUid}", corrUid);
        }
    }

    private static string SummarizeException(Exception ex)
    {
        var summary = $"{ex.GetType().Name}: {ex.Message}";
        return summary.Length > 300 ? summary[..300] + "…" : summary;
    }
}

/// <summary>No-op для unit-тестов без БД.</summary>
public sealed class NullJournalRegistrator : IJournalRegistrator
{
    public static NullJournalRegistrator Instance { get; } = new();

    public Task RegisterBreakOpenAsync(
        long connectionId, string corrUid, DateTimeOffset openedAt, string owner, string subtype,
        short? sourceId, string title, CancellationToken cancellationToken) =>
        Task.CompletedTask;

    public Task RegisterBreakHandoverAsync(
        string corrUid, DateTimeOffset escalatedAt, CancellationToken cancellationToken) =>
        Task.CompletedTask;

    public Task RegisterBreakRecoveringAsync(
        string corrUid, DateTimeOffset at, CancellationToken cancellationToken) =>
        Task.CompletedTask;

    public Task RegisterBreakAwaitOperatorAsync(
        string corrUid, DateTimeOffset at, CancellationToken cancellationToken) =>
        Task.CompletedTask;

    public Task RegisterBreakResolvedAsync(
        string corrUid, DateTimeOffset closedAt, string closeOutcome, string? title, string? severity,
        CancellationToken cancellationToken, string? resolvedBy = null) =>
        Task.CompletedTask;

    public Task RegisterCrashOpenAsync(
        string corrUid, DateTimeOffset openedAt, long? connectionId, string title,
        CancellationToken cancellationToken) =>
        Task.CompletedTask;

    public Task RegisterCrashOpenWithScopeAsync(
        string corrUid, DateTimeOffset openedAt, IReadOnlyList<long> connectionIds, string title,
        CancellationToken cancellationToken) =>
        Task.CompletedTask;

    public Task BindConnectionIdIfNullAsync(
        string corrUid, long connectionId, CancellationToken cancellationToken) =>
        Task.CompletedTask;

    public Task EnsureBreakAdoptedAsync(
        long connectionId, string corrUid, DateTimeOffset openedAt, string hubStatus, string owner,
        short? sourceId, CancellationToken cancellationToken) =>
        Task.CompletedTask;
}
