using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Host;

namespace Scinverse.Ohs.UnitTests;

public sealed class HostOutageConnectionEmitterTests
{
    private static readonly DateTimeOffset OutsideWindow = new(2026, 7, 30, 2, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset InsideWindow = new(2026, 7, 30, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Open_close_always_incident_and_journals_per_enabled_connection()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var journal = new RecordingJournal();
        var connections = new FakeConnectionStore(
            Conn(1, enabled: true),
            Conn(2, enabled: false),
            Conn(3, enabled: true));
        var emitter = new HostOutageConnectionEmitter(
            connections, hub, journal, NullLogger<HostOutageConnectionEmitter>.Instance);
        var coord = new HostOutageCoordinator();

        // Вне окна расписания — всё равно Incident + journal (P3).
        var open = coord.Report("a", OutsideWindow, to: null);
        await emitter.ApplyAsync(open);
        var close = coord.Report("a", OutsideWindow, OutsideWindow.AddMinutes(2));
        await emitter.ApplyAsync(close);

        var list = hub.List();
        list.Should().HaveCount(4); // 2 conn × open+close; disabled skipped
        list.Select(e => e.CorrelationId).Distinct().Should().BeEquivalentTo(
        [
            HostOutageConnectionEmitter.CorrUid(open.OutageSeed, 1),
            HostOutageConnectionEmitter.CorrUid(open.OutageSeed, 3),
        ]);

        foreach (var evt in list.Where(e => e.Code == HostOutageConnectionEmitter.CodeUnavailable))
        {
            DataString(evt, "threadKindHint").Should().Be(NotificationThreadData.KindIncident);
            evt.Severity.Should().Be("critical");
            DataLong(evt, "connectionId").Should().NotBeNull();
        }

        journal.CrashOpens.Should().BeEquivalentTo(
        [
            (HostOutageConnectionEmitter.CorrUid(open.OutageSeed, 1), 1L),
            (HostOutageConnectionEmitter.CorrUid(open.OutageSeed, 3), 3L),
        ]);
        journal.Resolves.Should().BeEquivalentTo(
        [
            HostOutageConnectionEmitter.CorrUid(open.OutageSeed, 1),
            HostOutageConnectionEmitter.CorrUid(open.OutageSeed, 3),
        ]);
    }

    [Fact]
    public async Task Message_binds_connection_id_on_open_and_close()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var journal = new RecordingJournal();
        var emitter = new HostOutageConnectionEmitter(
            new FakeConnectionStore(Conn(3, enabled: true)),
            hub,
            journal,
            NullLogger<HostOutageConnectionEmitter>.Instance);
        var coord = new HostOutageCoordinator();

        var open = coord.Report("a", InsideWindow, to: null);
        await emitter.ApplyAsync(open);
        await emitter.ApplyAsync(coord.Report("a", InsideWindow, InsideWindow.AddMinutes(1)));

        var seed = open.OutageSeed;
        var corr = HostOutageConnectionEmitter.CorrUid(seed, 3);
        hub.List().Single(e => e.Code == HostOutageConnectionEmitter.CodeUnavailable)
            .Message.Should().Be(HostOutageConnectionEmitter.MessageFor(3, HostOutageConnectionEmitter.OpenMessageBase));
        hub.List().Single(e => e.Code == HostOutageConnectionEmitter.CodeRecovered)
            .Message.Should().Be(HostOutageConnectionEmitter.MessageFor(3, HostOutageConnectionEmitter.CloseMessageBase));
        journal.CrashOpens.Should().ContainSingle().Which.Should().Be((corr, 3L));
        journal.Resolves.Should().ContainSingle().Which.Should().Be(corr);
    }

    [Fact]
    public async Task Merge_second_client_does_not_duplicate_c_opens()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var journal = new RecordingJournal();
        var emitter = new HostOutageConnectionEmitter(
            new FakeConnectionStore(Conn(3, enabled: true)),
            hub,
            journal,
            NullLogger<HostOutageConnectionEmitter>.Instance);
        var coord = new HostOutageCoordinator();

        await emitter.ApplyAsync(coord.Report("a", InsideWindow, to: null));
        await emitter.ApplyAsync(coord.Report("b", InsideWindow.AddSeconds(20), to: null));
        await emitter.ApplyAsync(coord.Report("b", InsideWindow.AddSeconds(20), InsideWindow.AddMinutes(1)));

        hub.List().Count(e => e.Code == HostOutageConnectionEmitter.CodeUnavailable).Should().Be(1);
        journal.CrashOpens.Should().HaveCount(1);
        journal.Resolves.Should().HaveCount(1);
    }

    [Fact]
    public async Task Zero_enabled_is_noop_for_layer_c()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var journal = new RecordingJournal();
        var emitter = new HostOutageConnectionEmitter(
            new FakeConnectionStore(Conn(1, enabled: false)),
            hub,
            journal,
            NullLogger<HostOutageConnectionEmitter>.Instance);

        await emitter.ApplyAsync(new HostOutageCoordinator().Report("a", InsideWindow, to: null));

        hub.List().Should().BeEmpty();
        journal.CrashOpens.Should().BeEmpty();
    }

    private static ConnectorConnection Conn(long id, bool enabled) => new()
    {
        ConnectionId = id,
        SourceId = 1,
        Name = $"c{id}",
        Kind = "transaq",
        Settings = "{}",
        Enabled = enabled,
    };

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

    private static long? DataLong(NotificationDto evt, string key)
    {
        if (evt.Data is not { } data || data.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (!data.TryGetProperty(key, out var p))
        {
            return null;
        }

        return p.ValueKind switch
        {
            JsonValueKind.Number => p.TryGetInt64(out var n) ? n : null,
            JsonValueKind.String => long.TryParse(p.GetString(), out var n) ? n : null,
            _ => null,
        };
    }

    private sealed class FakeConnectionStore(params ConnectorConnection[] rows) : IConnectionStore
    {
        public Task<IReadOnlyList<ConnectorConnection>> ListAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<ConnectorConnection>>(rows);

        public Task<ConnectorConnection?> GetAsync(long connectionId, CancellationToken cancellationToken) =>
            Task.FromResult(rows.FirstOrDefault(r => r.ConnectionId == connectionId));

        public Task<ConnectorConnection> UpsertAsync(
            short sourceId, string name, string kind, string settings, bool enabled,
            CancellationToken cancellationToken) =>
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

    private sealed class RecordingJournal : IJournalRegistrator
    {
        public List<(string Corr, long? ConnId)> CrashOpens { get; } = [];
        public List<string> Resolves { get; } = [];

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
            CancellationToken cancellationToken, string? resolvedBy = null)
        {
            Resolves.Add(corrUid);
            return Task.CompletedTask;
        }

        public Task RegisterCrashOpenAsync(
            string corrUid, DateTimeOffset openedAt, long? connectionId, string title,
            CancellationToken cancellationToken)
        {
            CrashOpens.Add((corrUid, connectionId));
            return Task.CompletedTask;
        }

        public Task BindConnectionIdIfNullAsync(
            string corrUid, long connectionId, CancellationToken cancellationToken) =>
            Task.CompletedTask;

        public Task EnsureBreakAdoptedAsync(
            long connectionId, string corrUid, DateTimeOffset openedAt, string hubStatus, string owner,
            short? sourceId, CancellationToken cancellationToken) =>
            Task.CompletedTask;
    }
}
