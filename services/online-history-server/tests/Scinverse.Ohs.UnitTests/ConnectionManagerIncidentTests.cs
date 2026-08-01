using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Host;

namespace Scinverse.Ohs.UnitTests;

/// <summary>
/// Close-break / Adopt на публичном API <see cref="ConnectionManager"/> + реальный
/// <see cref="NotificationHub"/> (I10/I11). Без reflection и без debug-эндпоинтов.
/// </summary>
public sealed class ConnectionManagerIncidentTests
{
    private const long ConnId = 7;

    [Fact]
    public void AdoptOpenIncident_and_ClearAdoptedIncident_toggle_memory()
    {
        var (manager, _, _) = CreateSut();
        var since = DateTimeOffset.Parse("2026-07-28T10:00:00Z");

        manager.AdoptOpenIncident(ConnId, since, owner: "supervisor").Should().BeTrue();
        manager.GetIncidentSince(ConnId).Should().Be(since);
        manager.AdoptOpenIncident(ConnId, since).Should().BeFalse("повторный Adopt — no-op");

        manager.ClearAdoptedIncident(ConnId).Should().BeTrue();
        manager.GetIncidentSince(ConnId).Should().BeNull();
        manager.ClearAdoptedIncident(ConnId).Should().BeFalse();
    }

    [Fact]
    public async Task EnsureBreak_then_abandon_manual_writes_disconnected_marker()
    {
        var (manager, hub, link) = CreateSut();
        var since = DateTimeOffset.Parse("2026-07-28T11:00:00Z");
        var end = since.AddMinutes(1);

        manager.EnsureBreakIncidentOnConnectFailure(ConnId, since, "Подключение 7 («t»)").Should().BeTrue();
        manager.EnsureBreakIncidentOnConnectFailure(ConnId, since, "x").Should().BeFalse();
        (await manager.TryAbandonIncidentByManualAsync(ConnId, end, CancellationToken.None))
            .Should().BeTrue();
        (await manager.TryAbandonIncidentByManualAsync(ConnId, end, CancellationToken.None))
            .Should().BeFalse("уже закрыто");

        manager.GetIncidentSince(ConnId).Should().BeNull();
        var list = hub.List();
        var userClose = list.Last(e => e.Code == NotificationThreadData.CodeIncidentForceClosed);
        userClose.SourceType.Should().Be("user");
        userClose.Severity.Should().Be("info");
        userClose.Message.Should().Contain("принудительно");
        var closed = list.Last(e => e.Code == "connection.incident_closed");
        closed.Status.Should().Be("resolved");
        closed.Severity.Should().Be("warning");
        closed.SourceType.Should().Be("system");
        DataString(closed, "closeOutcome").Should().Be(NotificationThreadData.OutcomeAbandonedManual);
        DataString(closed, "reason").Should().Be("manual_off");
        list.ToList().FindIndex(e => e.Id == userClose.Id)
            .Should().BeLessThan(list.ToList().FindIndex(e => e.Id == closed.Id), "user до system");
        link.Markers.Should().ContainSingle(m =>
            m.SourceId == 1 && m.Reason == LinkCloseReason.Disconnected && m.At == end);
    }

    [Fact]
    public void Adopt_protocol_Manager_then_Hub_session()
    {
        // I13: Manager SoT first; Hub — session для Progress/Append.
        var (manager, hub, _) = CreateSut();
        var subject = ConnectionManager.LinkIncidentSubject(ConnId);
        const string corr = "connection:7:link:abcd1234";
        var since = DateTimeOffset.Parse("2026-07-28T12:00:00Z");

        manager.AdoptOpenIncident(ConnId, since, corrUid: corr).Should().BeTrue();
        manager.AdoptOpenIncident(ConnId, since, corrUid: corr).Should().BeFalse("повторный Manager — no-op");
        manager.GetOpenBreakCorr(ConnId).Should().Be(corr);

        hub.Adopt(subject, corr, "active").Should().BeTrue();
        hub.Progress(subject, "connection.reconnecting", "x").Should().BeTrue();
    }

    [Fact]
    public void Adopt_protocol_success_allows_Progress_on_same_corr()
    {
        var (manager, hub, _) = CreateSut();
        var subject = ConnectionManager.LinkIncidentSubject(ConnId);
        const string corr = "connection:7:link:eeeeffff";
        var since = DateTimeOffset.Parse("2026-07-28T13:00:00Z");

        manager.AdoptOpenIncident(ConnId, since, owner: "supervisor", corrUid: corr).Should().BeTrue();
        hub.Adopt(subject, corr, "underway").Should().BeTrue();

        hub.Progress(subject, "connection.reconnecting", "попытка 1/5").Should().BeTrue();
        hub.List().Should().ContainSingle(e =>
            e.Code == "connection.reconnecting" && e.CorrelationId == corr);
        manager.GetOpenBreakCorr(ConnId).Should().Be(corr);
    }

    private static (ConnectionManager Manager, NotificationHub Hub, RecordingLinkLiveness Link) CreateSut()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var link = new RecordingLinkLiveness();
        var store = new FakeConnectionStore(new ConnectorConnection
        {
            ConnectionId = ConnId,
            SourceId = 1,
            Name = "t",
            Kind = "synthetic",
            Settings = "{}",
            Enabled = true,
        });

        var manager = new ConnectionManager(
            store,
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
            incidentStore: new EmptyIncidentStore(),
            notifications: hub,
            fanOut: new IncidentFanOut(
                hub, NullJournalRegistrator.Instance, NullLogger<IncidentFanOut>.Instance),
            transaqDefaults: new TransaqConnectorOptions(),
            options: new OhsOptions { LinkRecoverGraceSeconds = 3600 },
            loggerFactory: NullLoggerFactory.Instance,
            logger: NullLogger<ConnectionManager>.Instance);

        return (manager, hub, link);
    }

    private static string? DataString(NotificationDto evt, string key)
    {
        if (evt.Data is not { } data || data.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return data.TryGetProperty(key, out var p) && p.ValueKind == JsonValueKind.String
            ? p.GetString()
            : null;
    }

    private sealed class EmptyIncidentStore : IIncidentStore
    {
        public Task<bool> OpenAsync(Incident incident, CancellationToken cancellationToken) =>
            Task.FromResult(true);

        public Task<bool> UpdateOpenAsync(Incident incident, CancellationToken cancellationToken) =>
            Task.FromResult(false);

        public Task<bool> ResolveAsync(
            string corrUid, DateTimeOffset closedAt, string closeOutcome, string? title, string? severity,
            string? resolvedBy, CancellationToken cancellationToken) =>
            Task.FromResult(false);

        public Task<bool> AnnotateResolvedByAsync(
            string corrUid, string resolvedBy, CancellationToken cancellationToken) =>
            Task.FromResult(false);

        public Task<bool> AnnotateCloseNoteAsync(
            string corrUid, string closeNote, CancellationToken cancellationToken) =>
            Task.FromResult(false);

        public Task<bool> BindConnectionIdIfNullAsync(
            string corrUid, long connectionId, CancellationToken cancellationToken) =>
            Task.FromResult(false);

        public Task<Incident?> GetAsync(string corrUid, CancellationToken cancellationToken) =>
            Task.FromResult<Incident?>(null);

        public Task<Incident?> FindOpenBreakAsync(long connectionId, CancellationToken cancellationToken) =>
            Task.FromResult<Incident?>(null);

        public Task<IReadOnlyList<Incident>> QueryAsync(
            IncidentQuery query, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<Incident>>([]);

        public Task ReplaceConnectionScopeAsync(
            string corrUid, IReadOnlyList<long> connectionIds, CancellationToken cancellationToken) =>
            Task.CompletedTask;

        public Task<IReadOnlyList<long>> ListConnectionScopeAsync(
            string corrUid, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<long>>([]);
    }

    private sealed class FakeConnectionStore(ConnectorConnection row) : IConnectionStore
    {
        public Task<IReadOnlyList<ConnectorConnection>> ListAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<ConnectorConnection>>([row]);

        public Task<ConnectorConnection?> GetAsync(long connectionId, CancellationToken cancellationToken) =>
            Task.FromResult(connectionId == row.ConnectionId ? row : null);

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

    private sealed class RecordingLinkLiveness : ILinkLivenessStore
    {
        public List<(short SourceId, LinkCloseReason Reason, DateTimeOffset At)> Markers { get; } = [];

        public Task InsertBoundaryMarkerAsync(
            short sourceId, LinkCloseReason reason, DateTimeOffset atTs, CancellationToken cancellationToken)
        {
            Markers.Add((sourceId, reason, atTs));
            return Task.CompletedTask;
        }

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
