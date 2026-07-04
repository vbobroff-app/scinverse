using Dapper;
using FluentAssertions;
using Npgsql;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Storage.Timescale;

namespace Scinverse.Ohs.IntegrationTests;

public sealed class TimescaleTradeWriterTests : IClassFixture<TimescaleFixture>, IAsyncLifetime
{
    private static readonly DateTimeOffset BaseTime =
        new(2026, 7, 1, 10, 0, 0, TimeSpan.FromHours(3));

    private readonly TimescaleFixture _fixture;
    private readonly TimescaleTradeWriter _writer;

    public TimescaleTradeWriterTests(TimescaleFixture fixture)
    {
        _fixture = fixture;
        _writer = new TimescaleTradeWriter(fixture.DataSource);
    }

    public async Task InitializeAsync()
    {
        await using var connection = await _fixture.DataSource.OpenConnectionAsync();
        await connection.ExecuteAsync("TRUNCATE md_trade;");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task WriteAsync_PersistsBatch_AndReadsBack()
    {
        var trades = new[]
        {
            Trade(1, priceTicks: 25013, quantity: 7, MarketSide.Buy),
            Trade(2, priceTicks: 25010, quantity: 3, MarketSide.Sell),
            Trade(3, priceTicks: 25020, quantity: 1, MarketSide.Buy, openInterest: 555)
        };

        var inserted = await _writer.WriteAsync(trades, CancellationToken.None);

        inserted.Should().Be(3);
        (await CountAsync()).Should().Be(3);

        var third = await ReadAsync(tradeNo: 3);
        third.PriceTicks.Should().Be(25020);
        third.Side.Should().Be((short)MarketSide.Buy);
        third.OpenInterest.Should().Be(555);
    }

    [Fact]
    public async Task WriteAsync_IsIdempotent_OnDuplicateBatch()
    {
        var trades = new[]
        {
            Trade(10, priceTicks: 100, quantity: 1, MarketSide.Buy),
            Trade(11, priceTicks: 101, quantity: 2, MarketSide.Sell)
        };

        var first = await _writer.WriteAsync(trades, CancellationToken.None);
        var second = await _writer.WriteAsync(trades, CancellationToken.None);

        first.Should().Be(2);
        second.Should().Be(0, "повторный батч отсекается по PK (instrument_id, trade_no, ts)");
        (await CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task WriteAsync_StoresNullOpenInterest()
    {
        await _writer.WriteAsync(
            [Trade(20, priceTicks: 200, quantity: 5, MarketSide.Sell, openInterest: null)],
            CancellationToken.None);

        var row = await ReadAsync(tradeNo: 20);
        row.OpenInterest.Should().BeNull();
    }

    [Fact]
    public async Task WriteAsync_EmptyBatch_WritesNothing()
    {
        var inserted = await _writer.WriteAsync([], CancellationToken.None);

        inserted.Should().Be(0);
        (await CountAsync()).Should().Be(0);
    }

    private TradeRecord Trade(
        long tradeNo, long priceTicks, int quantity, MarketSide side, long? openInterest = null) => new()
    {
        InstrumentId = _fixture.InstrumentId,
        TradeNo = tradeNo,
        Timestamp = BaseTime.AddSeconds(tradeNo),
        PriceTicks = priceTicks,
        Quantity = quantity,
        Side = side,
        OpenInterest = openInterest
    };

    private async Task<long> CountAsync()
    {
        await using var connection = await _fixture.DataSource.OpenConnectionAsync();
        return await connection.ExecuteScalarAsync<long>("SELECT count(*) FROM md_trade;");
    }

    private async Task<TradeRow> ReadAsync(long tradeNo)
    {
        await using var connection = await _fixture.DataSource.OpenConnectionAsync();
        return await connection.QuerySingleAsync<TradeRow>(
            "SELECT price_ticks AS PriceTicks, side AS Side, open_interest AS OpenInterest " +
            "FROM md_trade WHERE instrument_id = @id AND trade_no = @no;",
            new { id = _fixture.InstrumentId, no = tradeNo });
    }

    private sealed class TradeRow
    {
        public long PriceTicks { get; init; }
        public short Side { get; init; }
        public long? OpenInterest { get; init; }
    }
}
