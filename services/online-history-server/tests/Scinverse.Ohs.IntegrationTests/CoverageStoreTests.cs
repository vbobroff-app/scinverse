using Dapper;
using FluentAssertions;
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
