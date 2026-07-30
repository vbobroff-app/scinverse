using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Domain.Moex;
using Scinverse.Ohs.Host;

namespace Scinverse.Ohs.UnitTests;

public sealed class HostOutageConnectionEmitterTests
{
    // 10:00 UTC = 13:00 MSK — внутри main 09:00–18:00.
    private static readonly DateTimeOffset InsideWindow = new(2026, 7, 30, 10, 0, 0, TimeSpan.Zero);
    // 02:00 UTC = 05:00 MSK — вне окна.
    private static readonly DateTimeOffset OutsideWindow = new(2026, 7, 30, 2, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Open_close_emits_c_corr_per_enabled_connection()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var journal = new RecordingJournal();
        var connections = new FakeConnectionStore(
            Conn(1, enabled: true),
            Conn(2, enabled: false),
            Conn(3, enabled: true));
        var schedules = new FakeScheduleStore(
            (1, EmptyState(1)),
            (3, EmptyState(3)));
        var emitter = new HostOutageConnectionEmitter(
            connections, schedules, new AlwaysTradingCalendar(), hub, journal,
            NullLogger<HostOutageConnectionEmitter>.Instance);
        var coord = new HostOutageCoordinator();

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
        journal.CrashOpens.Should().BeEmpty();
        journal.Resolves.Should().BeEmpty();
        foreach (var evt in list.Where(e => e.Code == HostOutageConnectionEmitter.CodeUnavailable))
        {
            DataString(evt, "threadKindHint").Should().Be(NotificationThreadData.KindGroup);
            DataLong(evt, "connectionId").Should().NotBeNull();
        }
    }

    [Fact]
    public async Task Desired_connection_opens_incident_and_journals()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var journal = new RecordingJournal();
        var connections = new FakeConnectionStore(Conn(1, enabled: true), Conn(3, enabled: true));
        var schedules = new FakeScheduleStore(
            (1, EmptyState(1)),
            (3, WindowState(3, new TimeOnly(9, 0), 540)));
        var emitter = new HostOutageConnectionEmitter(
            connections, schedules, new AlwaysTradingCalendar(), hub, journal,
            NullLogger<HostOutageConnectionEmitter>.Instance);
        var coord = new HostOutageCoordinator();

        var open = coord.Report("a", InsideWindow, to: null);
        await emitter.ApplyAsync(open);
        var close = coord.Report("a", InsideWindow, InsideWindow.AddMinutes(1));
        await emitter.ApplyAsync(close);

        var seed = open.OutageSeed;
        var openEvents = hub.List().Where(e => e.Code == HostOutageConnectionEmitter.CodeUnavailable).ToList();
        openEvents.Should().HaveCount(2);

        var idle = openEvents.Single(e => e.CorrelationId == HostOutageConnectionEmitter.CorrUid(seed, 1));
        DataString(idle, "threadKindHint").Should().Be(NotificationThreadData.KindGroup);
        idle.Severity.Should().Be("error");

        var desired = openEvents.Single(e => e.CorrelationId == HostOutageConnectionEmitter.CorrUid(seed, 3));
        DataString(desired, "threadKindHint").Should().Be(NotificationThreadData.KindIncident);
        desired.Severity.Should().Be("critical");
        DataLong(desired, "connectionId").Should().Be(3);
        desired.Message.Should().Be(HostOutageConnectionEmitter.MessageFor(3, HostOutageConnectionEmitter.OpenMessageBase));
        hub.List().Single(e => e.Code == HostOutageConnectionEmitter.CodeRecovered
                && e.CorrelationId == HostOutageConnectionEmitter.CorrUid(seed, 3))
            .Message.Should().Be(HostOutageConnectionEmitter.MessageFor(3, HostOutageConnectionEmitter.CloseMessageBase));

        journal.CrashOpens.Should().ContainSingle()
            .Which.Should().Be((HostOutageConnectionEmitter.CorrUid(seed, 3), 3L));
        journal.Resolves.Should().ContainSingle()
            .Which.Should().Be(HostOutageConnectionEmitter.CorrUid(seed, 3));
    }

    [Fact]
    public async Task Merge_second_client_does_not_duplicate_c_opens()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var journal = new RecordingJournal();
        var connections = new FakeConnectionStore(Conn(3, enabled: true));
        var schedules = new FakeScheduleStore((3, WindowState(3, new TimeOnly(9, 0), 540)));
        var emitter = new HostOutageConnectionEmitter(
            connections, schedules, new AlwaysTradingCalendar(), hub, journal,
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
            new FakeScheduleStore(),
            new AlwaysTradingCalendar(),
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

    private static ConnectionScheduleState EmptyState(long id) => new()
    {
        Settings = new ConnectionScheduleSettings
        {
            ConnectionId = id,
            AutoEnabled = false,
            Engine = "futures",
            Tz = "Europe/Moscow",
        },
        LiveRules = [],
    };

    private static ConnectionScheduleState WindowState(long id, TimeOnly open, int durationMin) => new()
    {
        Settings = new ConnectionScheduleSettings
        {
            ConnectionId = id,
            AutoEnabled = true,
            Engine = "futures",
            Tz = "Europe/Moscow",
        },
        LiveRules =
        [
            new ConnectionScheduleRule
            {
                ScheduleId = 1,
                ConnectionId = id,
                ScopeKind = ConnectionScheduleScopes.Main,
                Mode = ConnectionScheduleRuleModes.Window,
                OpenTime = open,
                DurationMin = durationMin,
                EffectiveFrom = DateTimeOffset.UnixEpoch,
                ChangeSource = "test",
            },
        ],
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

    private sealed class AlwaysTradingCalendar : IMarketCalendar
    {
        public Task<IReadOnlyList<TradingSession>> ShapeSessionsAsync(
            string engine, IReadOnlyList<DateOnly> dates, CancellationToken cancellationToken)
        {
            IReadOnlyList<TradingSession> sessions = dates
                .Select(d => new TradingSession
                {
                    Date = d,
                    Start = new DateTimeOffset(d.ToDateTime(TimeOnly.MinValue), MoexSchedule.MoscowOffset),
                    End = new DateTimeOffset(d.ToDateTime(new TimeOnly(23, 59)), MoexSchedule.MoscowOffset),
                    Weekend = d.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday,
                })
                .ToList();
            return Task.FromResult(sessions);
        }
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

    private sealed class FakeScheduleStore : IConnectionScheduleStore
    {
        private readonly Dictionary<long, ConnectionScheduleState> _states;

        public FakeScheduleStore(params (long Id, ConnectionScheduleState State)[] states) =>
            _states = states.ToDictionary(x => x.Id, x => x.State);

        public Task<ConnectionScheduleState> GetStateAsync(long connectionId, CancellationToken cancellationToken) =>
            Task.FromResult(
                _states.TryGetValue(connectionId, out var state)
                    ? state
                    : EmptyState(connectionId));

        public Task<ConnectionScheduleSettings> GetSettingsAsync(
            long connectionId, CancellationToken cancellationToken) =>
            GetStateAsync(connectionId, cancellationToken).ContinueWith(t => t.Result.Settings, cancellationToken);

        public Task<IReadOnlyList<ConnectionScheduleRule>> ListLiveRulesAsync(
            long connectionId, CancellationToken cancellationToken) =>
            GetStateAsync(connectionId, cancellationToken)
                .ContinueWith(t => t.Result.LiveRules, cancellationToken);

        public Task<IReadOnlyList<ConnectionScheduleRule>> ListHistoryAsync(
            long connectionId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<ConnectionScheduleState>> ListAutoEnabledAsync(
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<UpsertRuleResult> UpsertRuleAsync(
            long connectionId, ConnectionScheduleRuleDraft draft, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<ConnectionScheduleRule?> CancelRuleAsync(
            long connectionId, long scheduleId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<ScheduleBatchResult> ApplyBatchAsync(
            long connectionId,
            IReadOnlyList<ConnectionScheduleRuleDraft> upserts,
            IReadOnlyList<long> cancels,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<ConnectionScheduleSettings> SetSettingsAsync(
            long connectionId, bool? autoEnabled, string? engine, string? tz,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<ConnectionScheduleSettings> SetAutoAsync(
            long connectionId, bool autoEnabled, CancellationToken cancellationToken) =>
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
