using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Host;

namespace Scinverse.Ohs.UnitTests;

public sealed class JournalRegistratorTests
{
    [Fact]
    public async Task Open_handover_recovering_resolve_updates_store()
    {
        var store = new FakeIncidentStore();
        var journal = new JournalRegistrator(store, NullLogger<JournalRegistrator>.Instance);
        const string corr = "connection:7:link:abcd1234";
        var t0 = DateTimeOffset.Parse("2026-07-29T10:00:00Z");

        await journal.RegisterBreakOpenAsync(
            7, corr, t0, owner: "transaq", subtype: "degraded", sourceId: 1,
            title: "lost", CancellationToken.None);

        store.ByCorr[corr].Status.Should().Be("active");
        store.ByCorr[corr].Owner.Should().Be("transaq");
        store.ByCorr[corr].Subtype.Should().Be("degraded");
        store.ByCorr[corr].Subject.Should().Be("connection:7:link");

        var t1 = t0.AddSeconds(60);
        await journal.RegisterBreakHandoverAsync(corr, t1, CancellationToken.None);
        store.ByCorr[corr].EscalatedAt.Should().Be(t1);
        store.ByCorr[corr].Owner.Should().Be("supervisor");
        store.ByCorr[corr].Subtype.Should().Be("down");

        var t2 = t1.AddSeconds(5);
        await journal.RegisterBreakRecoveringAsync(corr, t2, CancellationToken.None);
        store.ByCorr[corr].Status.Should().Be("recovering");

        var t3 = t2.AddSeconds(10);
        await journal.RegisterBreakResolvedAsync(
            corr, t3, NotificationThreadData.OutcomeRecovered, title: null, severity: "ok",
            CancellationToken.None);
        store.ByCorr[corr].Status.Should().Be("resolved");
        store.ByCorr[corr].CloseOutcome.Should().Be(NotificationThreadData.OutcomeRecovered);
        store.ByCorr[corr].ClosedAt.Should().Be(t3);
    }

    [Fact]
    public async Task EnsureAdopted_inserts_when_missing_and_skips_when_present()
    {
        var store = new FakeIncidentStore();
        var journal = new JournalRegistrator(store, NullLogger<JournalRegistrator>.Instance);
        const string corr = "connection:3:link:deadbeef";
        var t0 = DateTimeOffset.Parse("2026-07-29T12:00:00Z");

        await journal.EnsureBreakAdoptedAsync(
            3, corr, t0, hubStatus: "underway", owner: "supervisor", sourceId: 2,
            CancellationToken.None);
        store.ByCorr[corr].Status.Should().Be("recovering");
        store.Opens.Should().Be(1);

        await journal.EnsureBreakAdoptedAsync(
            3, corr, t0, hubStatus: "active", owner: "supervisor", sourceId: 2,
            CancellationToken.None);
        store.Opens.Should().Be(1, "повторный adopt не INSERT");
    }

    [Fact]
    public async Task Store_exception_is_swallowed()
    {
        var journal = new JournalRegistrator(
            new ThrowingIncidentStore(), NullLogger<JournalRegistrator>.Instance);
        var act = () => journal.RegisterBreakOpenAsync(
            1, "c", DateTimeOffset.UtcNow, "supervisor", "down", null, "t", CancellationToken.None);
        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task EnsureBreak_then_abandon_writes_journal_open_and_resolve()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var link = new RecordingLinkLivenessForJournal();
        var store = new FakeIncidentStore();
        var journal = new JournalRegistrator(store, NullLogger<JournalRegistrator>.Instance);
        var fanOut = new IncidentFanOut(hub, journal, NullLogger<IncidentFanOut>.Instance);
        var connStore = new SingleConnectionStore(7, 1);
        var manager = new ConnectionManager(
            connStore,
            factory: null!,
            credentials: null!,
            parser: null!,
            registry: null!,
            sourceStore: null!,
            normalizer: null!,
            batcher: null!,
            coverageTracker: null!,
            broadcaster: new WebSocketBroadcaster(),
            liveness: new Lazy<ILivenessWriter>(() => throw new InvalidOperationException("unused")),
            recordings: new Lazy<RecordingManager>(() => throw new InvalidOperationException("unused")),
            linkLiveness: link,
            notifications: hub,
            fanOut: fanOut,
            transaqDefaults: new Connectors.Transaq.TransaqConnectorOptions(),
            options: new OhsOptions { LinkRecoverGraceSeconds = 3600 },
            loggerFactory: NullLoggerFactory.Instance,
            logger: NullLogger<ConnectionManager>.Instance);

        var since = DateTimeOffset.Parse("2026-07-29T14:00:00Z");
        var end = since.AddMinutes(2);
        manager.EnsureBreakIncidentOnConnectFailure(7, since, "Подключение 7").Should().BeTrue();
        store.ByCorr.Should().ContainSingle();
        var corr = store.ByCorr.Keys.Single();
        corr.Should().StartWith("connection:7:link:");
        store.ByCorr[corr].Status.Should().Be("active");

        (await manager.TryAbandonIncidentByScheduleAsync(7, end, CancellationToken.None)).Should().BeTrue();
        store.ByCorr[corr].Status.Should().Be("resolved");
        store.ByCorr[corr].CloseOutcome.Should().Be(NotificationThreadData.OutcomeAbandonedSchedule);
    }

    private sealed class FakeIncidentStore : IIncidentStore
    {
        public Dictionary<string, Incident> ByCorr { get; } = new(StringComparer.Ordinal);
        public int Opens { get; private set; }

        public Task<bool> OpenAsync(Incident incident, CancellationToken cancellationToken)
        {
            if (ByCorr.ContainsKey(incident.CorrUid))
            {
                return Task.FromResult(false);
            }

            ByCorr[incident.CorrUid] = incident;
            Opens++;
            return Task.FromResult(true);
        }

        public Task<bool> UpdateOpenAsync(Incident incident, CancellationToken cancellationToken)
        {
            if (!ByCorr.TryGetValue(incident.CorrUid, out var existing) || existing.Status == "resolved")
            {
                return Task.FromResult(false);
            }

            ByCorr[incident.CorrUid] = incident;
            return Task.FromResult(true);
        }

        public Task<bool> ResolveAsync(
            string corrUid, DateTimeOffset closedAt, string closeOutcome, string? title, string? severity,
            string? resolvedBy, CancellationToken cancellationToken)
        {
            if (!ByCorr.TryGetValue(corrUid, out var existing) || existing.Status == "resolved")
            {
                return Task.FromResult(false);
            }

            var payload = existing.Payload;
            if (!string.IsNullOrWhiteSpace(resolvedBy))
            {
                payload = $"{{\"resolvedBy\":\"{resolvedBy}\"}}";
            }

            ByCorr[corrUid] = existing with
            {
                Status = "resolved",
                ClosedAt = closedAt,
                CloseOutcome = closeOutcome,
                Title = title ?? existing.Title,
                Severity = severity ?? existing.Severity,
                LastActivityAt = closedAt,
                Payload = payload,
            };
            return Task.FromResult(true);
        }

        public Task<bool> AnnotateResolvedByAsync(
            string corrUid, string resolvedBy, CancellationToken cancellationToken)
        {
            if (!ByCorr.TryGetValue(corrUid, out var existing))
            {
                return Task.FromResult(false);
            }

            ByCorr[corrUid] = existing with { Payload = $"{{\"resolvedBy\":\"{resolvedBy}\"}}" };
            return Task.FromResult(true);
        }

        public Task<bool> BindConnectionIdIfNullAsync(
            string corrUid, long connectionId, CancellationToken cancellationToken)
        {
            if (!ByCorr.TryGetValue(corrUid, out var existing) || existing.ConnectionId is not null)
            {
                return Task.FromResult(false);
            }

            ByCorr[corrUid] = existing with { ConnectionId = connectionId };
            return Task.FromResult(true);
        }

        public Task<Incident?> GetAsync(string corrUid, CancellationToken cancellationToken) =>
            Task.FromResult(ByCorr.TryGetValue(corrUid, out var i) ? i : null);

        public Task<IReadOnlyList<Incident>> QueryAsync(IncidentQuery query, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<Incident>>(ByCorr.Values.ToList());
    }

    private sealed class ThrowingIncidentStore : IIncidentStore
    {
        public Task<bool> OpenAsync(Incident incident, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("db down");

        public Task<bool> UpdateOpenAsync(Incident incident, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("db down");

        public Task<bool> ResolveAsync(
            string corrUid, DateTimeOffset closedAt, string closeOutcome, string? title, string? severity,
            string? resolvedBy, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("db down");

        public Task<bool> AnnotateResolvedByAsync(
            string corrUid, string resolvedBy, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("db down");

        public Task<bool> BindConnectionIdIfNullAsync(
            string corrUid, long connectionId, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("db down");

        public Task<Incident?> GetAsync(string corrUid, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("db down");

        public Task<IReadOnlyList<Incident>> QueryAsync(IncidentQuery query, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("db down");
    }

    private sealed class SingleConnectionStore(long id, short sourceId) : IConnectionStore
    {
        private readonly ConnectorConnection _row = new()
        {
            ConnectionId = id,
            SourceId = sourceId,
            Name = "t",
            Kind = "synthetic",
            Settings = "{}",
            Enabled = true,
        };

        public Task<IReadOnlyList<ConnectorConnection>> ListAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<ConnectorConnection>>([_row]);

        public Task<ConnectorConnection?> GetAsync(long connectionId, CancellationToken cancellationToken) =>
            Task.FromResult(connectionId == _row.ConnectionId ? _row : null);

        public Task<ConnectorConnection> UpsertAsync(
            short sourceId, string name, string kind, string settings, bool enabled, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<ConnectorConnection?> UpdateAsync(
            long connectionId, short sourceId, string name, string kind, string settings, bool enabled,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<bool> DeleteAsync(long connectionId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task SetEnabledAsync(long connectionId, bool enabled, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }

    private sealed class RecordingLinkLivenessForJournal : ILinkLivenessStore
    {
        public Task InsertBoundaryMarkerAsync(
            short sourceId, LinkCloseReason reason, DateTimeOffset atTs, CancellationToken cancellationToken) =>
            Task.CompletedTask;

        public Task HeartbeatAsync(
            short sourceId, DateTimeOffset ts, TimeSpan maxGap, CancellationToken cancellationToken) =>
            Task.CompletedTask;

        public Task<int> CloseAsync(
            short sourceId, LinkCloseReason reason, DateTimeOffset? atTs, CancellationToken cancellationToken) =>
            Task.FromResult(0);

        public Task<LinkInterval?> GetLastAsync(short sourceId, CancellationToken cancellationToken) =>
            Task.FromResult<LinkInterval?>(null);

        public Task<IReadOnlyList<LinkInterval>> QueryAsync(
            IReadOnlyCollection<short> sourceIds, DateTimeOffset from, DateTimeOffset to,
            CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<LinkInterval>>([]);

        public Task<IReadOnlyList<LinkGap>> QueryGapsAsync(
            IReadOnlyCollection<short> sourceIds, DateTimeOffset from, DateTimeOffset to,
            CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<LinkGap>>([]);

        public Task<int> RecoverOpenIntervalsAsync(CancellationToken cancellationToken) =>
            Task.FromResult(0);
    }
}
