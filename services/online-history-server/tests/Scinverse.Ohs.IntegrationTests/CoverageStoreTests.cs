using Dapper;
using FluentAssertions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Storage.Timescale;

namespace Scinverse.Ohs.IntegrationTests;

public sealed class CoverageStoreTests : IClassFixture<TimescaleFixture>, IAsyncLifetime
{
    private const short TransaqSource = 1;

    private readonly TimescaleFixture _fixture;
    private readonly CoverageStore _store;

    public CoverageStoreTests(TimescaleFixture fixture)
    {
        _fixture = fixture;
        _store = new CoverageStore(fixture.DataSource);
    }

    public async Task InitializeAsync()
    {
        await using var connection = await _fixture.DataSource.OpenConnectionAsync();
        await connection.ExecuteAsync("TRUNCATE coverage_segment;");
        await connection.ExecuteAsync("TRUNCATE md_trade;");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task OpenAsync_IsIdempotent_WhileSegmentActive()
    {
        var started = DateTimeOffset.UtcNow;

        var first = await _store.OpenAsync(_fixture.InstrumentId, TransaqSource, started, CancellationToken.None);
        var second = await _store.OpenAsync(_fixture.InstrumentId, TransaqSource, started, CancellationToken.None);

        second.Should().Be(first, "активный сегмент один на (instrument, source)");
        (await CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task ExtendAsync_AccumulatesTradeCount()
    {
        var segmentId = await _store.OpenAsync(
            _fixture.InstrumentId, TransaqSource, DateTimeOffset.UtcNow, CancellationToken.None);

        await _store.ExtendAsync(segmentId, 100, CancellationToken.None);
        await _store.ExtendAsync(segmentId, 50, CancellationToken.None);
        await _store.ExtendAsync(segmentId, 0, CancellationToken.None);

        var row = await ReadAsync(segmentId);
        row.TradeCount.Should().Be(150);
        row.EndedAt.Should().BeNull("сегмент ещё активен");
    }

    [Fact]
    public async Task CloseAsync_SetsEndedAtAndStatus_AndAllowsNewSegment()
    {
        var started = DateTimeOffset.UtcNow;
        var segmentId = await _store.OpenAsync(_fixture.InstrumentId, TransaqSource, started, CancellationToken.None);

        await _store.CloseAsync(segmentId, started.AddMinutes(5), "stopped", CancellationToken.None);

        var closed = await ReadAsync(segmentId);
        closed.EndedAt.Should().NotBeNull();
        closed.Status.Should().Be("stopped");

        // После закрытия можно открыть новый активный сегмент.
        var next = await _store.OpenAsync(
            _fixture.InstrumentId, TransaqSource, started.AddMinutes(6), CancellationToken.None);
        next.Should().NotBe(segmentId);
        (await CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task QueryTradingDaysAsync_ReturnsDistinctMoscowDates_NewestFirst()
    {
        // Пн 2026-07-06 (две сделки) и Ср 2026-07-08 (одна). Даты в МСК.
        await InsertTradeAsync(new DateTimeOffset(2026, 7, 6, 10, 0, 0, MoexSchedule.MoscowOffset), 1);
        await InsertTradeAsync(new DateTimeOffset(2026, 7, 6, 12, 0, 0, MoexSchedule.MoscowOffset), 2);
        await InsertTradeAsync(new DateTimeOffset(2026, 7, 8, 15, 0, 0, MoexSchedule.MoscowOffset), 3);

        var days = await _store.QueryTradingDaysAsync(10, includeWeekends: true, CancellationToken.None);

        days.Should().Equal(new DateOnly(2026, 7, 8), new DateOnly(2026, 7, 6));
    }

    [Fact]
    public async Task QueryTradingDaysAsync_ExcludesWeekends_WhenNotRequested()
    {
        await InsertTradeAsync(new DateTimeOffset(2026, 7, 10, 12, 0, 0, MoexSchedule.MoscowOffset), 1); // Пт
        await InsertTradeAsync(new DateTimeOffset(2026, 7, 11, 12, 0, 0, MoexSchedule.MoscowOffset), 2); // Сб
        await InsertTradeAsync(new DateTimeOffset(2026, 7, 12, 12, 0, 0, MoexSchedule.MoscowOffset), 3); // Вс

        var withoutWeekends = await _store.QueryTradingDaysAsync(10, includeWeekends: false, CancellationToken.None);
        var withWeekends = await _store.QueryTradingDaysAsync(10, includeWeekends: true, CancellationToken.None);

        withoutWeekends.Should().Equal(new DateOnly(2026, 7, 10));
        withWeekends.Should().HaveCount(3);
    }

    [Fact]
    public async Task QueryTradingDaysAsync_RespectsLimit()
    {
        for (var day = 6; day <= 10; day++)
        {
            await InsertTradeAsync(new DateTimeOffset(2026, 7, day, 12, 0, 0, MoexSchedule.MoscowOffset), day);
        }

        var days = await _store.QueryTradingDaysAsync(2, includeWeekends: true, CancellationToken.None);

        days.Should().Equal(new DateOnly(2026, 7, 10), new DateOnly(2026, 7, 9));
    }

    [Fact]
    public async Task QueryCoverageExtentAsync_SpansEarliestStartToLatestEnd()
    {
        var early = new DateTimeOffset(2026, 7, 1, 8, 0, 0, TimeSpan.Zero);
        var first = await _store.OpenAsync(_fixture.InstrumentId, TransaqSource, early, CancellationToken.None);
        await _store.CloseAsync(first, early.AddHours(2), "stopped", CancellationToken.None);

        var late = new DateTimeOffset(2026, 7, 3, 8, 0, 0, TimeSpan.Zero);
        var second = await _store.OpenAsync(_fixture.InstrumentId, TransaqSource, late, CancellationToken.None);
        await _store.CloseAsync(second, late.AddHours(1), "stopped", CancellationToken.None);

        var extent = await _store.QueryCoverageExtentAsync(null, CancellationToken.None);

        extent.From!.Value.Should().Be(early);
        extent.To!.Value.Should().Be(late.AddHours(1));
    }

    [Fact]
    public async Task QueryCoverageExtentAsync_UsesNow_ForActiveSegment()
    {
        var started = DateTimeOffset.UtcNow.AddHours(-1);
        await _store.OpenAsync(_fixture.InstrumentId, TransaqSource, started, CancellationToken.None);

        var extent = await _store.QueryCoverageExtentAsync(null, CancellationToken.None);

        extent.From!.Value.Should().BeCloseTo(started, TimeSpan.FromSeconds(2));
        extent.To!.Value.Should().BeCloseTo(DateTimeOffset.UtcNow, TimeSpan.FromMinutes(1));
    }

    [Fact]
    public async Task QueryCoverageExtentAsync_ReturnsNulls_WhenEmpty()
    {
        var extent = await _store.QueryCoverageExtentAsync(null, CancellationToken.None);

        extent.From.Should().BeNull();
        extent.To.Should().BeNull();
    }

    [Fact]
    public async Task RecoverOpenSegmentsAsync_ClosesOrphan_AtLastLivenessWhenLaterThanTrade()
    {
        var started = new DateTimeOffset(2026, 7, 6, 10, 0, 0, TimeSpan.Zero);
        var segmentId = await _store.OpenAsync(_fixture.InstrumentId, TransaqSource, started, CancellationToken.None);
        await InsertTradeAsync(started.AddMinutes(5), 1);
        var lastTrade = started.AddMinutes(20);
        await InsertTradeAsync(lastTrade, 2);

        var lastLiveness = started.AddMinutes(35);
        await using (var connection = await _fixture.DataSource.OpenConnectionAsync())
        {
            await connection.ExecuteAsync(
                "INSERT INTO capture_liveness (source_id, from_ts, to_ts, open) VALUES (@sourceId, @from, @to, true);",
                new { sourceId = TransaqSource, from = started.UtcDateTime, to = lastLiveness.UtcDateTime });
        }

        var closed = await _store.RecoverOpenSegmentsAsync(CancellationToken.None);

        closed.Should().Be(1);
        var row = await ReadAsync(segmentId);
        row.EndedAt.Should().Be(lastLiveness, "осиротевший сегмент тянется до последнего хартбита живости");
        row.Status.Should().Be("interrupted");
    }

    [Fact]
    public async Task RecoverOpenSegmentsAsync_ClosesOrphan_AtLastTradeTime()
    {
        var started = new DateTimeOffset(2026, 7, 6, 10, 0, 0, TimeSpan.Zero);
        var segmentId = await _store.OpenAsync(_fixture.InstrumentId, TransaqSource, started, CancellationToken.None);
        await InsertTradeAsync(started.AddMinutes(5), 1);
        var lastTrade = started.AddMinutes(20);
        await InsertTradeAsync(lastTrade, 2);

        var closed = await _store.RecoverOpenSegmentsAsync(CancellationToken.None);

        closed.Should().Be(1);
        var row = await ReadAsync(segmentId);
        row.EndedAt.Should().Be(lastTrade, "осиротевший сегмент закрывается по времени последней сделки");
        row.Status.Should().Be("interrupted");
    }

    [Fact]
    public async Task RecoverOpenSegmentsAsync_ClosesEmptyOrphan_AtStartedAt()
    {
        var started = new DateTimeOffset(2026, 7, 6, 10, 0, 0, TimeSpan.Zero);
        var segmentId = await _store.OpenAsync(_fixture.InstrumentId, TransaqSource, started, CancellationToken.None);

        var closed = await _store.RecoverOpenSegmentsAsync(CancellationToken.None);

        closed.Should().Be(1);
        var row = await ReadAsync(segmentId);
        row.EndedAt.Should().Be(started, "без сделок закрываем по started_at (пустой сегмент)");
        row.Status.Should().Be("interrupted");
    }

    [Fact]
    public async Task RecoverOpenSegmentsAsync_LeavesClosedSegments_Untouched()
    {
        var started = new DateTimeOffset(2026, 7, 6, 10, 0, 0, TimeSpan.Zero);
        var segmentId = await _store.OpenAsync(_fixture.InstrumentId, TransaqSource, started, CancellationToken.None);
        await _store.CloseAsync(segmentId, started.AddMinutes(3), "stopped", CancellationToken.None);

        var closed = await _store.RecoverOpenSegmentsAsync(CancellationToken.None);

        closed.Should().Be(0, "закрытые сегменты recovery не трогает");
        var row = await ReadAsync(segmentId);
        row.Status.Should().Be("stopped");
    }

    private async Task InsertTradeAsync(DateTimeOffset ts, long tradeNo)
    {
        await using var connection = await _fixture.DataSource.OpenConnectionAsync();
        await connection.ExecuteAsync(
            "INSERT INTO md_trade (ts, instrument_id, source_id, trade_no, price_ticks, quantity, side) " +
            "VALUES (@ts, @instrumentId, @sourceId, @tradeNo, 100, 1, 1);",
            new
            {
                ts = ts.ToUniversalTime(),
                instrumentId = _fixture.InstrumentId,
                sourceId = TransaqSource,
                tradeNo
            });
    }

    private async Task<long> CountAsync()
    {
        await using var connection = await _fixture.DataSource.OpenConnectionAsync();
        return await connection.ExecuteScalarAsync<long>("SELECT count(*) FROM coverage_segment;");
    }

    private async Task<SegmentRow> ReadAsync(long segmentId)
    {
        await using var connection = await _fixture.DataSource.OpenConnectionAsync();
        return await connection.QuerySingleAsync<SegmentRow>(
            "SELECT trade_count AS TradeCount, ended_at AS EndedAt, status AS Status " +
            "FROM coverage_segment WHERE segment_id = @id;",
            new { id = segmentId });
    }

    private sealed class SegmentRow
    {
        public long TradeCount { get; init; }
        public DateTimeOffset? EndedAt { get; init; }
        public string Status { get; init; } = string.Empty;
    }
}
