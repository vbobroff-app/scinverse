using Dapper;
using FluentAssertions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Storage.Timescale;

namespace Scinverse.Ohs.IntegrationTests;

public sealed class ConnectionScheduleStoreTests : IClassFixture<TimescaleFixture>, IAsyncLifetime
{
    private const int Weekend = 32 | 64; // Сб,Вс
    private const int Saturday = 32;
    private const int Sunday = 64;

    private readonly TimescaleFixture _fixture;
    private readonly ConnectionScheduleStore _store;
    private long _connectionId;

    public ConnectionScheduleStoreTests(TimescaleFixture fixture)
    {
        _fixture = fixture;
        _store = new ConnectionScheduleStore(fixture.DataSource);
    }

    public async Task InitializeAsync()
    {
        await using var connection = await _fixture.DataSource.OpenConnectionAsync();
        await connection.ExecuteAsync("TRUNCATE connection_schedule; TRUNCATE connection_schedule_settings;");
        _connectionId = await connection.ExecuteScalarAsync<long>(
            """
            INSERT INTO connector_connection (source_id, name, kind, settings)
            VALUES (2, @name, 'synthetic', '{}')
            ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
            RETURNING connection_id;
            """,
            new { name = $"test-conn-sched-{Guid.NewGuid():N}" });
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static ConnectionScheduleRuleDraft Draft(
        string scope, string mode, TimeOnly? open = null, int? dur = null, int? mask = null) => new()
    {
        ScopeKind = scope,
        Mode = mode,
        OpenTime = open,
        DurationMin = dur,
        DowMask = mask,
        ChangeSource = "test",
    };

    [Fact]
    public async Task Upsert_main_versions_via_scd2()
    {
        var v1 = await _store.UpsertRuleAsync(
            _connectionId, Draft("main", "window", new TimeOnly(7, 0), 600), CancellationToken.None);
        v1.Rule.IsLive.Should().BeTrue();
        v1.SupersededIds.Should().BeEmpty();

        var v2 = await _store.UpsertRuleAsync(
            _connectionId, Draft("main", "window", new TimeOnly(8, 0), 660), CancellationToken.None);
        v2.SupersededIds.Should().Contain(v1.Rule.ScheduleId);

        var live = await _store.ListLiveRulesAsync(_connectionId, CancellationToken.None);
        live.Should().ContainSingle().Which.ScheduleId.Should().Be(v2.Rule.ScheduleId);

        var history = await _store.ListHistoryAsync(_connectionId, CancellationToken.None);
        history.Should().HaveCount(2);
    }

    [Fact]
    public async Task Auto_retires_subset_masks_as_superseded()
    {
        var sun = await _store.UpsertRuleAsync(
            _connectionId, Draft("dow", "window", new TimeOnly(10, 0), 240, Sunday), CancellationToken.None);

        // {Вс} ⊆ {Сб,Вс} → закрываем как superseded.
        var weekend = await _store.UpsertRuleAsync(
            _connectionId, Draft("dow", "window", new TimeOnly(10, 0), 540, Weekend), CancellationToken.None);
        weekend.SupersededIds.Should().Contain(sun.Rule.ScheduleId);

        var live = await _store.ListLiveRulesAsync(_connectionId, CancellationToken.None);
        live.Should().ContainSingle().Which.DowMask.Should().Be(Weekend);
    }

    [Fact]
    public async Task Narrow_over_broad_keeps_broad_alive()
    {
        var weekend = await _store.UpsertRuleAsync(
            _connectionId, Draft("dow", "window", new TimeOnly(10, 0), 540, Weekend), CancellationToken.None);

        // {Сб} ⊄ {Сб,Вс} по правилу «old ⊆ new» (weekend не вложено в {Сб}) → weekend остаётся живым.
        var sat = await _store.UpsertRuleAsync(
            _connectionId, Draft("dow", "window", new TimeOnly(14, 0), 300, Saturday), CancellationToken.None);
        sat.SupersededIds.Should().NotContain(weekend.Rule.ScheduleId);

        var live = await _store.ListLiveRulesAsync(_connectionId, CancellationToken.None);
        live.Should().HaveCount(2);
    }

    [Fact]
    public async Task Cancel_closes_rule_as_canceled()
    {
        var weekend = await _store.UpsertRuleAsync(
            _connectionId, Draft("dow", "window", new TimeOnly(10, 0), 540, Weekend), CancellationToken.None);

        var canceled = await _store.CancelRuleAsync(_connectionId, weekend.Rule.ScheduleId, CancellationToken.None);
        canceled.Should().NotBeNull();
        canceled!.CloseReason.Should().Be(ConnectionScheduleCloseReasons.Canceled);

        var live = await _store.ListLiveRulesAsync(_connectionId, CancellationToken.None);
        live.Should().BeEmpty();

        // Повторный cancel уже закрытого → null.
        var again = await _store.CancelRuleAsync(_connectionId, weekend.Rule.ScheduleId, CancellationToken.None);
        again.Should().BeNull();
    }

    [Fact]
    public async Task Settings_default_then_set_and_auto_listing()
    {
        var def = await _store.GetSettingsAsync(_connectionId, CancellationToken.None);
        def.AutoEnabled.Should().BeFalse();
        def.Engine.Should().Be("futures");

        await _store.UpsertRuleAsync(
            _connectionId, Draft("main", "window", new TimeOnly(7, 0), 600), CancellationToken.None);

        (await _store.ListAutoEnabledAsync(CancellationToken.None))
            .Should().NotContain(s => s.Settings.ConnectionId == _connectionId);

        await _store.SetAutoAsync(_connectionId, true, CancellationToken.None);
        var states = await _store.ListAutoEnabledAsync(CancellationToken.None);
        var mine = states.Should().ContainSingle(s => s.Settings.ConnectionId == _connectionId).Subject;
        mine.LiveRules.Should().ContainSingle();

        await _store.SetSettingsAsync(_connectionId, null, "currency", null, CancellationToken.None);
        (await _store.GetSettingsAsync(_connectionId, CancellationToken.None)).Engine.Should().Be("currency");
    }

    [Fact]
    public async Task Off_mode_rule_persists_without_window()
    {
        var off = await _store.UpsertRuleAsync(
            _connectionId, Draft("dow", "off", mask: Weekend), CancellationToken.None);
        off.Rule.Mode.Should().Be(ConnectionScheduleRuleModes.Off);
        off.Rule.OpenTime.Should().BeNull();

        var live = await _store.ListLiveRulesAsync(_connectionId, CancellationToken.None);
        live.Should().ContainSingle().Which.Mode.Should().Be(ConnectionScheduleRuleModes.Off);
    }
}
