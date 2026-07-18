using Dapper;
using FluentAssertions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Storage.Timescale;

namespace Scinverse.Ohs.IntegrationTests;

public sealed class ConnectionScheduleStoreTests : IClassFixture<TimescaleFixture>, IAsyncLifetime
{
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
        await connection.ExecuteAsync("TRUNCATE connection_schedule;");
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

    [Fact]
    public async Task PublishWindow_CreatesCurrent_AndSecondPublish_Versions()
    {
        var v1 = await _store.PublishWindowAsync(
            _connectionId,
            ConnectionScheduleModes.Manual,
            new TimeOnly(6, 0),
            new TimeOnly(1, 0),
            "futures",
            "Europe/Moscow",
            "ui",
            "first",
            CancellationToken.None);

        v1.IsCurrent.Should().BeTrue();
        v1.WindowStart.Should().Be(new TimeOnly(6, 0));
        v1.ChangeNote.Should().Be("first");

        var v2 = await _store.PublishWindowAsync(
            _connectionId,
            ConnectionScheduleModes.Scheduled,
            new TimeOnly(7, 0),
            new TimeOnly(2, 0),
            "futures",
            "Europe/Moscow",
            "preset_moex_futures_pm1h",
            "second",
            CancellationToken.None);

        v2.IsCurrent.Should().BeTrue();
        v2.AutoEnabled.Should().BeTrue();
        v2.WindowStart.Should().Be(new TimeOnly(7, 0));

        var history = await _store.ListHistoryAsync(_connectionId, CancellationToken.None);
        history.Should().HaveCount(2);
        history[0].ScheduleId.Should().Be(v2.ScheduleId);
        history[1].EffectiveTo.Should().NotBeNull();
        history[1].ScheduleId.Should().Be(v1.ScheduleId);

        var current = await _store.GetCurrentAsync(_connectionId, CancellationToken.None);
        current!.ScheduleId.Should().Be(v2.ScheduleId);
    }

    [Fact]
    public async Task SetMode_UpdatesCurrent_WithoutNewVersion()
    {
        await _store.PublishWindowAsync(
            _connectionId,
            ConnectionScheduleModes.Manual,
            new TimeOnly(6, 0),
            new TimeOnly(1, 0),
            "futures",
            "Europe/Moscow",
            "ui",
            null,
            CancellationToken.None);

        var updated = await _store.SetModeAsync(
            _connectionId, ConnectionScheduleModes.Scheduled, CancellationToken.None);

        updated!.AutoEnabled.Should().BeTrue();
        var history = await _store.ListHistoryAsync(_connectionId, CancellationToken.None);
        history.Should().ContainSingle();
        history[0].Mode.Should().Be(ConnectionScheduleModes.Scheduled);
    }

    [Fact]
    public async Task ListCurrentScheduled_OnlyAutoOn()
    {
        await _store.PublishWindowAsync(
            _connectionId,
            ConnectionScheduleModes.Scheduled,
            new TimeOnly(6, 0),
            new TimeOnly(1, 0),
            "futures",
            "Europe/Moscow",
            "ui",
            null,
            CancellationToken.None);

        var list = await _store.ListCurrentScheduledAsync(CancellationToken.None);
        list.Should().Contain(e => e.ConnectionId == _connectionId);

        await _store.SetModeAsync(_connectionId, ConnectionScheduleModes.Manual, CancellationToken.None);
        list = await _store.ListCurrentScheduledAsync(CancellationToken.None);
        list.Should().NotContain(e => e.ConnectionId == _connectionId);
    }
}
