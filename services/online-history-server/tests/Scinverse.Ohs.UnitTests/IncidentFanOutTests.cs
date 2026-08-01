using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Host;

namespace Scinverse.Ohs.UnitTests;

public sealed class IncidentFanOutTests
{
    [Fact]
    public async Task Open_then_resolve_writes_same_corr_to_journal_and_hub()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var store = new MemIncidentStore();
        var journal = new JournalRegistrator(store, NullLogger<JournalRegistrator>.Instance);
        var fanOut = new IncidentFanOut(hub, journal, NullLogger<IncidentFanOut>.Instance);

        const string subject = "connection:7:link";
        var t0 = DateTimeOffset.Parse("2026-07-29T10:00:00Z");
        var corr = await fanOut.ApplyAsync(
            new IncidentStep(
                IncidentStepKind.Open,
                subject,
                t0,
                ConnectionId: 7,
                Owner: "transaq",
                Subtype: "degraded",
                SourceId: 1,
                Title: "lost",
                NcCode: "connection.lost",
                NcMessage: "Подключение 7: связь потеряна",
                NcSeverity: "error",
                NcData: new { connectionId = 7L }),
            CancellationToken.None);

        corr.Should().NotBeNullOrEmpty();
        var corrUid = corr!;
        corrUid.Should().StartWith(subject + ":");
        store.ByCorr[corrUid].Status.Should().Be("active");
        store.ByCorr[corrUid].Type.Should().Be("break");
        hub.TryGetOpenCorrelationId(subject, out var openCorr).Should().BeTrue();
        openCorr.Should().Be(corrUid);
        hub.List().Should().ContainSingle(e => e.Code == "connection.lost" && e.Ts == t0);

        var t1 = t0.AddMinutes(1);
        var closed = await fanOut.ApplyAsync(
            new IncidentStep(
                IncidentStepKind.Resolve,
                subject,
                t1,
                CorrUid: corrUid,
                CloseOutcome: NotificationThreadData.OutcomeRecovered,
                Severity: "ok",
                NcCode: "connection.recovered",
                NcMessage: "Подключение 7: связь восстановлена",
                NcSeverity: "ok",
                NcData: new { connectionId = 7L, closeOutcome = NotificationThreadData.OutcomeRecovered }),
            CancellationToken.None);

        closed.Should().Be(corrUid);
        store.ByCorr[corrUid].Status.Should().Be("resolved");
        store.ByCorr[corrUid].CloseOutcome.Should().Be(NotificationThreadData.OutcomeRecovered);
        store.ByCorr[corrUid].ClosedAt.Should().Be(t1);
        hub.TryGetOpenCorrelationId(subject, out _).Should().BeFalse();
        hub.List().Should().ContainSingle(e => e.Code == "connection.recovered" && e.Ts == t1);
    }

    [Fact]
    public async Task Resolve_without_preloaded_corr_uses_open_hub_before_close()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var store = new MemIncidentStore();
        var journal = new JournalRegistrator(store, NullLogger<JournalRegistrator>.Instance);
        var fanOut = new IncidentFanOut(hub, journal, NullLogger<IncidentFanOut>.Instance);
        const string subject = "connection:3:link";
        var t0 = DateTimeOffset.Parse("2026-07-29T11:00:00Z");

        var corr = await fanOut.ApplyAsync(
            new IncidentStep(
                IncidentStepKind.Open,
                subject,
                t0,
                ConnectionId: 3,
                Owner: "supervisor",
                Subtype: "down",
                NcCode: "connection.lost",
                NcMessage: "lost"),
            CancellationToken.None);

        corr.Should().NotBeNullOrEmpty();
        var corrUid = corr!;

        // CorrUid не передаём — фасад обязан снять его до Hub.Resolve.
        await fanOut.ApplyAsync(
            new IncidentStep(
                IncidentStepKind.Resolve,
                subject,
                t0.AddSeconds(30),
                CloseOutcome: NotificationThreadData.OutcomeRecovered,
                NcCode: "connection.recovered",
                NcMessage: "ok",
                NcSeverity: "ok"),
            CancellationToken.None);

        store.ByCorr[corrUid].Status.Should().Be("resolved");
    }

    [Fact]
    public async Task Crash_open_writes_type_crash()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var store = new MemIncidentStore();
        var journal = new JournalRegistrator(store, NullLogger<JournalRegistrator>.Instance);
        var fanOut = new IncidentFanOut(hub, journal, NullLogger<IncidentFanOut>.Instance);
        const string subject = "ohs.backend.outage";
        var t0 = DateTimeOffset.Parse("2026-07-29T12:00:00Z");

        var corr = await fanOut.ApplyAsync(
            new IncidentStep(
                IncidentStepKind.CrashOpen,
                subject,
                t0,
                ConnectionId: 1,
                Title: "Система недоступна",
                NcCode: "ohs.backend.unavailable",
                NcMessage: "Система недоступна",
                NcSeverity: "critical"),
            CancellationToken.None);

        corr.Should().NotBeNullOrEmpty();
        var corrUid = corr!;
        corrUid.Should().StartWith(subject + ":");
        store.ByCorr[corrUid].Type.Should().Be("crash");
        store.ByCorr[corrUid].Status.Should().Be("active");
    }

    [Fact]
    public async Task Recovered_before_crash_open_leaves_journal_resolved()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var store = new MemIncidentStore();
        var journal = new JournalRegistrator(store, NullLogger<JournalRegistrator>.Instance);
        var fanOut = new IncidentFanOut(hub, journal, NullLogger<IncidentFanOut>.Instance);
        const string subject = "ohs.backend.outage";
        const string corr = "ohs.backend.outage:race01";
        var tOpen = DateTimeOffset.Parse("2026-07-29T16:00:00Z");
        var tClose = tOpen.AddMinutes(2);

        // Бывший parallel batch: recovered раньше unavailable → journal всё равно terminal.
        await fanOut.ApplyAsync(
            new IncidentStep(
                IncidentStepKind.Resolve,
                subject,
                tClose,
                CorrUid: corr,
                CloseOutcome: NotificationThreadData.OutcomeRecovered,
                Severity: "ok",
                Title: "Система восстановлена"),
            CancellationToken.None);

        await fanOut.ApplyAsync(
            new IncidentStep(
                IncidentStepKind.CrashOpen,
                subject,
                tOpen,
                CorrUid: corr,
                ConnectionId: 2,
                Title: "Система недоступна"),
            CancellationToken.None);

        store.ByCorr[corr].Status.Should().Be("resolved");
        store.ByCorr[corr].CloseOutcome.Should().Be(NotificationThreadData.OutcomeRecovered);
        store.ByCorr[corr].ClosedAt.Should().Be(tClose);
    }

    [Fact]
    public async Task Parallel_crash_open_and_resolve_converges_to_resolved()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var store = new MemIncidentStore();
        var journal = new JournalRegistrator(store, NullLogger<JournalRegistrator>.Instance);
        var fanOut = new IncidentFanOut(hub, journal, NullLogger<IncidentFanOut>.Instance);
        const string subject = "ohs.backend.outage";
        const string corr = "ohs.backend.outage:race02";
        var tOpen = DateTimeOffset.Parse("2026-07-29T16:10:00Z");
        var tClose = tOpen.AddMinutes(1);

        await Task.WhenAll(
            fanOut.ApplyAsync(
                new IncidentStep(
                    IncidentStepKind.CrashOpen,
                    subject,
                    tOpen,
                    CorrUid: corr,
                    ConnectionId: 3,
                    Title: "down"),
                CancellationToken.None),
            fanOut.ApplyAsync(
                new IncidentStep(
                    IncidentStepKind.Resolve,
                    subject,
                    tClose,
                    CorrUid: corr,
                    CloseOutcome: NotificationThreadData.OutcomeRecovered,
                    Severity: "ok"),
                CancellationToken.None));

        store.ByCorr.Should().ContainKey(corr);
        store.ByCorr[corr].Status.Should().Be("resolved");
        store.ByCorr[corr].CloseOutcome.Should().Be(NotificationThreadData.OutcomeRecovered);
    }

    [Fact]
    public async Task Crash_open_after_ingest_is_journal_only_when_no_nc_code()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var store = new MemIncidentStore();
        var journal = new JournalRegistrator(store, NullLogger<JournalRegistrator>.Instance);
        var fanOut = new IncidentFanOut(hub, journal, NullLogger<IncidentFanOut>.Instance);
        const string subject = "ohs.backend.outage";
        const string corr = "ohs.backend.outage:deadbeef";
        var t0 = DateTimeOffset.Parse("2026-07-29T14:00:00Z");

        // Как POST /notifications: NC уже Ingest'нут клиентом; fan-out только journal.
        hub.Ingest(
            Guid.NewGuid().ToString("N"),
            t0,
            "backend.unavailable",
            "Система недоступна",
            severity: "critical",
            status: "active",
            correlationId: corr);

        await fanOut.ApplyAsync(
            new IncidentStep(
                IncidentStepKind.CrashOpen,
                subject,
                t0,
                CorrUid: corr,
                ConnectionId: 1,
                Title: "Система недоступна"),
            CancellationToken.None);

        store.ByCorr[corr].Type.Should().Be("crash");
        store.ByCorr[corr].Status.Should().Be("active");
        // Ingest не сеет Hub open-map; без NcCode fan-out не зовёт Open — один атом в ring.
        hub.List(10).Should().ContainSingle(e => e.CorrelationId == corr && e.Code == "backend.unavailable");
        hub.TryGetOpenCorrelationId(subject, out _).Should().BeFalse();
    }

    [Fact]
    public async Task Resolve_skip_journal_emits_nc_only()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var store = new MemIncidentStore();
        var journal = new JournalRegistrator(store, NullLogger<JournalRegistrator>.Instance);
        var fanOut = new IncidentFanOut(hub, journal, NullLogger<IncidentFanOut>.Instance);
        const string subject = "connection:1:link";
        var t0 = DateTimeOffset.Parse("2026-07-29T15:00:00Z");

        var corr = await fanOut.ApplyAsync(
            new IncidentStep(
                IncidentStepKind.Open,
                subject,
                t0,
                ConnectionId: 1,
                Owner: "supervisor",
                Subtype: "down",
                NcCode: "connection.lost",
                NcMessage: "lost"),
            CancellationToken.None);

        await fanOut.ApplyAsync(
            new IncidentStep(
                IncidentStepKind.Resolve,
                subject,
                t0.AddMinutes(1),
                CorrUid: corr,
                CloseOutcome: NotificationThreadData.OutcomeAbandonedManual,
                NcCode: "connection.incident_closed",
                NcMessage: "closed",
                NcSeverity: "warning",
                SkipJournal: true),
            CancellationToken.None);

        store.ByCorr[corr!].Status.Should().Be("active", "SkipJournal не трогает incident");
        hub.TryGetOpenCorrelationId(subject, out _).Should().BeFalse();
    }

    [Fact]
    public async Task Journal_only_handover_skips_nc_when_no_code()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var store = new MemIncidentStore();
        var journal = new JournalRegistrator(store, NullLogger<JournalRegistrator>.Instance);
        var fanOut = new IncidentFanOut(hub, journal, NullLogger<IncidentFanOut>.Instance);
        const string subject = "connection:9:link";
        var t0 = DateTimeOffset.Parse("2026-07-29T13:00:00Z");

        var corr = await fanOut.ApplyAsync(
            new IncidentStep(
                IncidentStepKind.Open,
                subject,
                t0,
                ConnectionId: 9,
                Owner: "transaq",
                Subtype: "degraded",
                NcCode: "connection.lost",
                NcMessage: "lost"),
            CancellationToken.None);

        corr.Should().NotBeNullOrEmpty();
        var corrUid = corr!;
        var t1 = t0.AddSeconds(60);
        await fanOut.ApplyAsync(
            new IncidentStep(IncidentStepKind.Handover, subject, t1, CorrUid: corrUid),
            CancellationToken.None);

        store.ByCorr[corrUid].Owner.Should().Be("supervisor");
        store.ByCorr[corrUid].EscalatedAt.Should().Be(t1);
    }

    private sealed class MemIncidentStore : IIncidentStore
    {
        private readonly object _gate = new();
        public Dictionary<string, Incident> ByCorr { get; } = new(StringComparer.Ordinal);

        public Task<bool> OpenAsync(Incident incident, CancellationToken cancellationToken)
        {
            lock (_gate)
            {
                if (ByCorr.ContainsKey(incident.CorrUid))
                {
                    return Task.FromResult(false);
                }

                ByCorr[incident.CorrUid] = incident;
                return Task.FromResult(true);
            }
        }

        public Task<bool> UpdateOpenAsync(Incident incident, CancellationToken cancellationToken)
        {
            lock (_gate)
            {
                if (!ByCorr.TryGetValue(incident.CorrUid, out var existing) || existing.Status == "resolved")
                {
                    return Task.FromResult(false);
                }

                ByCorr[incident.CorrUid] = incident;
                return Task.FromResult(true);
            }
        }

        public Task<bool> ResolveAsync(
            string corrUid, DateTimeOffset closedAt, string closeOutcome, string? title, string? severity,
            string? resolvedBy, CancellationToken cancellationToken)
        {
            lock (_gate)
            {
                if (!ByCorr.TryGetValue(corrUid, out var existing) || existing.Status == "resolved")
                {
                    return Task.FromResult(false);
                }

                ByCorr[corrUid] = existing with
                {
                    Status = "resolved",
                    ClosedAt = closedAt,
                    CloseOutcome = closeOutcome,
                    Title = title ?? existing.Title,
                    Severity = severity ?? existing.Severity,
                    LastActivityAt = closedAt,
                };
                return Task.FromResult(true);
            }
        }

        public Task<bool> AnnotateResolvedByAsync(
            string corrUid, string resolvedBy, CancellationToken cancellationToken) =>
            Task.FromResult(false);

        public Task<bool> BindConnectionIdIfNullAsync(
            string corrUid, long connectionId, CancellationToken cancellationToken)
        {
            lock (_gate)
            {
                if (!ByCorr.TryGetValue(corrUid, out var existing) || existing.ConnectionId is not null)
                {
                    return Task.FromResult(false);
                }

                ByCorr[corrUid] = existing with { ConnectionId = connectionId };
                return Task.FromResult(true);
            }
        }

        public Task<Incident?> GetAsync(string corrUid, CancellationToken cancellationToken)
        {
            lock (_gate)
            {
                return Task.FromResult(ByCorr.TryGetValue(corrUid, out var i) ? i : null);
            }
        }

        public Task<Incident?> FindOpenBreakAsync(long connectionId, CancellationToken cancellationToken)
        {
            lock (_gate)
            {
                var open = ByCorr.Values
                    .Where(i => i.ConnectionId == connectionId
                                && i.Type == "break"
                                && i.Status is "active" or "recovering")
                    .OrderByDescending(i => i.OpenedAt)
                    .FirstOrDefault();
                return Task.FromResult(open);
            }
        }

        public Task<IReadOnlyList<Incident>> QueryAsync(IncidentQuery query, CancellationToken cancellationToken)
        {
            lock (_gate)
            {
                return Task.FromResult<IReadOnlyList<Incident>>(ByCorr.Values.ToList());
            }
        }

        public Task ReplaceConnectionScopeAsync(
            string corrUid, IReadOnlyList<long> connectionIds, CancellationToken cancellationToken) =>
            Task.CompletedTask;

        public Task<IReadOnlyList<long>> ListConnectionScopeAsync(
            string corrUid, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<long>>([]);
    }
}
