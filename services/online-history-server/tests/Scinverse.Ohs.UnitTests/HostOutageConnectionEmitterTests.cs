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
    public async Task Open_close_one_transport_thread_and_scope_per_enabled()
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

        var open = coord.Report("a", OutsideWindow, to: null);
        await emitter.ApplyAsync(open);
        var close = coord.Report("a", OutsideWindow, OutsideWindow.AddMinutes(2));
        await emitter.ApplyAsync(close);

        var corr = HostOutageConnectionEmitter.CorrUid(open.OutageSeed);
        var list = hub.List();
        list.Should().HaveCount(2); // 1 open + 1 close
        list.Select(e => e.CorrelationId).Distinct().Should().Equal(corr);

        var openEvt = list.Single(e => e.Code == HostOutageConnectionEmitter.CodeUnavailable);
        DataString(openEvt, "threadKindHint").Should().Be(NotificationThreadData.KindIncident);
        openEvt.Severity.Should().Be("critical");
        openEvt.Message.Should().Be(HostOutageConnectionEmitter.OpenMessageBase);
        DataLongArray(openEvt, "connectionIds").Should().BeEquivalentTo([1L, 3L]);

        journal.CrashOpens.Should().ContainSingle().Which.Should().Be((corr, (long?)null));
        journal.Scopes.Should().ContainSingle().Which.Should().BeEquivalentTo((corr, new long[] { 1, 3 }));
        journal.Resolves.Should().Equal(corr);
    }

    [Fact]
    public async Task Merge_second_client_does_not_duplicate_opens()
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
        journal.Scopes.Should().HaveCount(1);
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
        journal.Scopes.Should().BeEmpty();
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

    private static long[] DataLongArray(NotificationDto evt, string key)
    {
        if (evt.Data is not { } data || data.ValueKind != JsonValueKind.Object)
        {
            return [];
        }

        if (!data.TryGetProperty(key, out var p) || p.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return p.EnumerateArray()
            .Select(el => el.ValueKind switch
            {
                JsonValueKind.Number when el.TryGetInt64(out var n) => n,
                JsonValueKind.String when long.TryParse(el.GetString(), out var s) => s,
                _ => (long?)null,
            })
            .Where(n => n is not null)
            .Select(n => n!.Value)
            .ToArray();
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
        public List<(string Corr, long[] Ids)> Scopes { get; } = [];
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

        public Task RegisterBreakAwaitOperatorAsync(
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

        public Task RegisterCrashOpenWithScopeAsync(
            string corrUid, DateTimeOffset openedAt, IReadOnlyList<long> connectionIds, string title,
            CancellationToken cancellationToken)
        {
            CrashOpens.Add((corrUid, null));
            Scopes.Add((corrUid, connectionIds.ToArray()));
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
