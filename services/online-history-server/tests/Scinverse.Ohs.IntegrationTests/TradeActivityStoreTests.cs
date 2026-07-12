using Dapper;
using FluentAssertions;
using Scinverse.Ohs.Storage.Timescale;

namespace Scinverse.Ohs.IntegrationTests;

/// <summary>
/// Присутствие сделок по бакетам: закрытые дни берутся из кэша (trade_activity_bucket +
/// маркеры trade_activity_computed), текущий («живой») день считается на лету из md_trade.
/// </summary>
public sealed class TradeActivityStoreTests : IClassFixture<TimescaleFixture>, IAsyncLifetime
{
    private const short TransaqSource = 1;

    private readonly TimescaleFixture _fixture;

    public TradeActivityStoreTests(TimescaleFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await using var connection = await _fixture.DataSource.OpenConnectionAsync();
        await connection.ExecuteAsync("TRUNCATE md_trade;");
        await connection.ExecuteAsync("TRUNCATE trade_activity_bucket;");
        await connection.ExecuteAsync("TRUNCATE trade_activity_computed;");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task QueryActivityAsync_CachesClosedDays_AndComputesLiveTail()
    {
        // «Сейчас» = 2026-07-08 12:00 UTC → закрытые дни: 07-06, 07-07; живой день: 07-08.
        var now = new DateTimeOffset(2026, 7, 8, 12, 0, 0, TimeSpan.Zero);
        var store = new TradeActivityStore(_fixture.DataSource, new FixedTimeProvider(now));
        var bucket = TimeSpan.FromMinutes(1);

        var closedBucket = new DateTimeOffset(2026, 7, 6, 10, 0, 0, TimeSpan.Zero);
        var liveBucket = new DateTimeOffset(2026, 7, 8, 9, 30, 0, TimeSpan.Zero);
        await InsertTradeAsync(closedBucket, 1); // закрытый день 07-06
        await InsertTradeAsync(liveBucket, 2);   // живой день 07-08
        // 07-07 — сделок нет (пустой закрытый день).

        var from = new DateTimeOffset(2026, 7, 6, 0, 0, 0, TimeSpan.Zero);
        var ids = new[] { _fixture.InstrumentId };

        var first = await store.QueryActivityAsync(ids, TransaqSource, from, now, bucket, CancellationToken.None);

        first.Single().Buckets.Should().BeEquivalentTo(new[] { closedBucket, liveBucket });

        // Закрытые дни (в т.ч. пустой 07-07) помечены посчитанными; живой 07-08 — нет.
        var computed = await ComputedDaysAsync();
        computed.Should().Contain(new DateOnly(2026, 7, 6));
        computed.Should().Contain(new DateOnly(2026, 7, 7));
        computed.Should().NotContain(new DateOnly(2026, 7, 8));

        // Досыпаем сделку в уже посчитанный закрытый день 07-07 — она НЕ должна появиться:
        // закрытые дни авторитетно берутся из кэша, а не пересчитываются.
        await InsertTradeAsync(new DateTimeOffset(2026, 7, 7, 11, 0, 0, TimeSpan.Zero), 3);

        var second = await store.QueryActivityAsync(ids, TransaqSource, from, now, bucket, CancellationToken.None);

        second.Single().Buckets.Should().BeEquivalentTo(new[] { closedBucket, liveBucket });
    }

    [Fact]
    public async Task QueryActivityAsync_ReturnsEmpty_ForInstrumentWithoutTrades()
    {
        var now = new DateTimeOffset(2026, 7, 8, 12, 0, 0, TimeSpan.Zero);
        var store = new TradeActivityStore(_fixture.DataSource, new FixedTimeProvider(now));
        var from = new DateTimeOffset(2026, 7, 6, 0, 0, 0, TimeSpan.Zero);

        var result = await store.QueryActivityAsync(
            new[] { _fixture.InstrumentId }, TransaqSource, from, now, TimeSpan.FromMinutes(1), CancellationToken.None);

        result.Should().ContainSingle();
        result.Single().InstrumentId.Should().Be(_fixture.InstrumentId);
        result.Single().Buckets.Should().BeEmpty("сделок нет — ни одного бакета");
    }

    private async Task InsertTradeAsync(DateTimeOffset ts, long tradeNo)
    {
        await using var connection = await _fixture.DataSource.OpenConnectionAsync();
        await connection.ExecuteAsync(
            "INSERT INTO md_trade (ts, instrument_id, source_id, trade_no, price_ticks, quantity, side) " +
            "VALUES (@ts, @instrumentId, @sourceId, @tradeNo, 100, 1, 1);",
            new { ts = ts.ToUniversalTime(), instrumentId = _fixture.InstrumentId, sourceId = TransaqSource, tradeNo });
    }

    private async Task<IReadOnlyList<DateOnly>> ComputedDaysAsync()
    {
        await using var connection = await _fixture.DataSource.OpenConnectionAsync();
        var days = await connection.QueryAsync<DateTime>("SELECT day FROM trade_activity_computed ORDER BY day;");
        return days.Select(DateOnly.FromDateTime).ToList();
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
