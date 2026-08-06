using Dapper;
using FluentAssertions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Storage.Timescale;

namespace Scinverse.Ohs.IntegrationTests;

public sealed class BasketStoreTests : IClassFixture<TimescaleFixture>, IAsyncLifetime
{
    private readonly TimescaleFixture _fixture;
    private readonly BasketStore _store;
    private long _connectionId;

    public BasketStoreTests(TimescaleFixture fixture)
    {
        _fixture = fixture;
        _store = new BasketStore(fixture.DataSource);
    }

    public async Task InitializeAsync()
    {
        await using var connection = await _fixture.DataSource.OpenConnectionAsync();
        await connection.ExecuteAsync(
            """
            TRUNCATE basket_member, basket_rule, instrument_basket RESTART IDENTITY CASCADE;
            """);
        _connectionId = await connection.ExecuteScalarAsync<long>(
            """
            INSERT INTO connector_connection (source_id, name, kind, settings)
            VALUES (2, @name, 'synthetic', '{}')
            ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
            RETURNING connection_id;
            """,
            new { name = $"test-basket-{Guid.NewGuid():N}" });
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task EnsureSystem_creates_recording_and_has_data()
    {
        await _store.EnsureSystemBasketsAsync(_connectionId, CancellationToken.None);
        await _store.EnsureSystemBasketsAsync(_connectionId, CancellationToken.None);

        var list = await _store.ListAsync(_connectionId, CancellationToken.None);
        list.Should().HaveCount(2);
        list.Should().Contain(b =>
            b.SystemId == BasketStore.SystemRecording && b.Enabled && b.Kind == BasketKind.System);
        list.Should().Contain(b =>
            b.SystemId == BasketStore.SystemHasData && !b.Enabled && b.Kind == BasketKind.System);
    }

    [Fact]
    public async Task CreateStatic_Update_SetEnabled_Members_Delete()
    {
        var created = await _store.CreateStaticAsync(
            _connectionId,
            " Si Futures ",
            new BasketRule
            {
                Patterns = ["Si-*.*", "Si-*.2[0-9]"],
                SecType = "FUT",
                BoardId = "FUT",
            },
            enabled: true,
            CancellationToken.None);

        created.Kind.Should().Be(BasketKind.Static);
        created.Name.Should().Be("Si Futures");
        created.Enabled.Should().BeTrue();
        created.Rule!.Patterns.Should().Equal("Si-*.*", "Si-*.2[0-9]");
        created.Rule.SecType.Should().Be("FUT");

        var updated = await _store.UpdateStaticAsync(
            created.BasketId,
            "Si",
            new BasketRule { Patterns = ["Si-*.*"], SecType = "FUT" },
            CancellationToken.None);
        updated.Name.Should().Be("Si");
        updated.Rule!.Patterns.Should().Equal("Si-*.*");

        var disabled = await _store.SetEnabledAsync(created.BasketId, false, CancellationToken.None);
        disabled.Enabled.Should().BeFalse();

        await _store.ReplaceMembersAsync(
            created.BasketId, [_fixture.InstrumentId, _fixture.InstrumentId], CancellationToken.None);
        (await _store.ListMemberIdsAsync(created.BasketId, CancellationToken.None))
            .Should().Equal(_fixture.InstrumentId);

        // disabled static → не в enabled union
        (await _store.ListEnabledStaticMemberIdsAsync(_connectionId, CancellationToken.None))
            .Should().BeEmpty();

        await _store.SetEnabledAsync(created.BasketId, true, CancellationToken.None);
        (await _store.ListEnabledStaticMemberIdsAsync(_connectionId, CancellationToken.None))
            .Should().Equal(_fixture.InstrumentId);

        await _store.DeleteAsync(created.BasketId, CancellationToken.None);
        (await _store.GetAsync(created.BasketId, CancellationToken.None)).Should().BeNull();
        (await _store.ListMemberIdsAsync(created.BasketId, CancellationToken.None)).Should().BeEmpty();
    }

    [Fact]
    public async Task Delete_system_throws()
    {
        var list = await _store.ListAsync(_connectionId, CancellationToken.None);
        var recording = list.Single(b => b.SystemId == BasketStore.SystemRecording);

        var act = () => _store.DeleteAsync(recording.BasketId, CancellationToken.None);
        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*System basket*");
    }

    [Fact]
    public async Task SetEnabled_persists_on_system_has_data()
    {
        var list = await _store.ListAsync(_connectionId, CancellationToken.None);
        var hasData = list.Single(b => b.SystemId == BasketStore.SystemHasData);
        hasData.Enabled.Should().BeFalse();

        var enabled = await _store.SetEnabledAsync(hasData.BasketId, true, CancellationToken.None);
        enabled.Enabled.Should().BeTrue();

        var again = await _store.ListAsync(_connectionId, CancellationToken.None);
        again.Single(b => b.SystemId == BasketStore.SystemHasData).Enabled.Should().BeTrue();
    }
}
