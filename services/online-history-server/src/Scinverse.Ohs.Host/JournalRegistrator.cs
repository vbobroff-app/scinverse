using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>Персист журнала инцидентов через <see cref="IIncidentStore"/>. Ошибки БД логируются, не роняют control-plane.</summary>
public sealed class JournalRegistrator(
    IIncidentStore store,
    ILogger<JournalRegistrator> logger) : IJournalRegistrator
{
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
            () => store.ResolveAsync(
                corrUid, closedAt, closeOutcome, title, severity, resolvedBy, cancellationToken));

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
            () => store.OpenAsync(
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
                cancellationToken));

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
        }
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

    public Task RegisterBreakResolvedAsync(
        string corrUid, DateTimeOffset closedAt, string closeOutcome, string? title, string? severity,
        CancellationToken cancellationToken, string? resolvedBy = null) =>
        Task.CompletedTask;

    public Task RegisterCrashOpenAsync(
        string corrUid, DateTimeOffset openedAt, long? connectionId, string title,
        CancellationToken cancellationToken) =>
        Task.CompletedTask;

    public Task EnsureBreakAdoptedAsync(
        long connectionId, string corrUid, DateTimeOffset openedAt, string hubStatus, string owner,
        short? sourceId, CancellationToken cancellationToken) =>
        Task.CompletedTask;
}
