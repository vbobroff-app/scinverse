using Dapper;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Host;
using Scinverse.Ohs.Storage.Timescale;

namespace Scinverse.Ohs.IntegrationTests;

public sealed class BasketEvalServiceTests : IClassFixture<TimescaleFixture>, IAsyncLifetime
{
    private readonly TimescaleFixture _fixture;
    private readonly BasketStore _baskets;
    private readonly InstrumentStore _instruments;
    private readonly ConnectionStore _connections;
    private BasketEvalService _eval = null!;
    private long _connectionId;

    public BasketEvalServiceTests(TimescaleFixture fixture)
    {
        _fixture = fixture;
        _baskets = new BasketStore(fixture.DataSource);
        _instruments = new InstrumentStore(fixture.DataSource, TimeProvider.System);
        _connections = new ConnectionStore(fixture.DataSource);
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
            new { name = $"test-eval-{Guid.NewGuid():N}" });

        _eval = new BasketEvalService(
            _instruments,
            _baskets,
            _connections,
            NullLogger<BasketEvalService>.Instance);

        // Available: Si FUT + SHARE (SBER уже в fixture) + RTS
        await _instruments.UpsertAsync(
            new SecurityInfo
            {
                Key = new InstrumentKey("Si-9.26", "FUT"),
                MinStep = 1m,
                SecType = "FUT",
                Expiration = new DateOnly(2026, 9, 17),
            },
            CancellationToken.None);
        await _instruments.UpsertAsync(
            new SecurityInfo
            {
                Key = new InstrumentKey("RTS-3.27", "FUT"),
                MinStep = 1m,
                SecType = "FUT",
                Expiration = new DateOnly(2027, 3, 1),
            },
            CancellationToken.None);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Materialize_and_ReEval_drops_inactive_adds_new()
    {
        var basket = await _baskets.CreateStaticAsync(
            _connectionId,
            "Si+RTS",
            new BasketRule { Patterns = ["Si-*.*", "RTS-*.2[0-9]"], SecType = "FUT" },
            enabled: true,
            CancellationToken.None);

        var count = await _eval.MaterializeAsync(basket.BasketId, CancellationToken.None);
        count.Should().Be(2);
        var members = await _baskets.ListMemberIdsAsync(basket.BasketId, CancellationToken.None);
        members.Should().HaveCount(2);

        // Архив Si → active=false; re-eval должен убрать из members.
        await using (var connection = await _fixture.DataSource.OpenConnectionAsync())
        {
            await connection.ExecuteAsync(
                """
                UPDATE instrument SET active = FALSE
                WHERE ticker = 'Si-9.26' AND board_id = 'FUT';
                """);
        }

        // Новый матч
        await _instruments.UpsertAsync(
            new SecurityInfo
            {
                Key = new InstrumentKey("Si-12.26", "FUT"),
                MinStep = 1m,
                SecType = "FUT",
                Expiration = new DateOnly(2026, 12, 17),
            },
            CancellationToken.None);

        await _eval.ReEvalConnectionAsync(_connectionId, CancellationToken.None);

        var after = await _baskets.ListMemberIdsAsync(basket.BasketId, CancellationToken.None);
        var available = await _instruments.ListAvailableAsync(CancellationToken.None);
        var tickers = available
            .Where(a => after.Contains(a.InstrumentId))
            .Select(a => a.Ticker)
            .OrderBy(t => t)
            .ToList();

        tickers.Should().Equal("RTS-3.27", "Si-12.26");
        tickers.Should().NotContain("Si-9.26");
    }
}
