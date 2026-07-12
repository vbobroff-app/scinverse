using Dapper;
using FluentAssertions;
using Scinverse.Ohs.Storage.Timescale;

namespace Scinverse.Ohs.IntegrationTests;

/// <summary>
/// Живость захвата (honest background, phase 7h): компактные интервалы «связь жива». Хартбит в пределах
/// maxGap продлевает открытый интервал; больший разрыв тиков рвёт его на два; Close/Recover закрывают открытый.
/// </summary>
public sealed class CaptureLivenessStoreTests : IClassFixture<TimescaleFixture>, IAsyncLifetime
{
    private const short TransaqSource = 1;
    private static readonly TimeSpan MaxGap = TimeSpan.FromSeconds(45);

    private readonly TimescaleFixture _fixture;
    private readonly CaptureLivenessStore _store;

    public CaptureLivenessStoreTests(TimescaleFixture fixture)
    {
        _fixture = fixture;
        _store = new CaptureLivenessStore(fixture.DataSource);
    }

    public async Task InitializeAsync()
    {
        await using var connection = await _fixture.DataSource.OpenConnectionAsync();
        await connection.ExecuteAsync("TRUNCATE capture_liveness;");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Heartbeat_ExtendsWithinGap_AndSplitsOnLargeGap()
    {
        var t0 = new DateTimeOffset(2026, 7, 8, 10, 0, 0, TimeSpan.Zero);

        // Три хартбита с шагом 15 c → один растущий интервал [t0, t0+30s].
        await _store.HeartbeatAsync(TransaqSource, t0, MaxGap, CancellationToken.None);
        await _store.HeartbeatAsync(TransaqSource, t0.AddSeconds(15), MaxGap, CancellationToken.None);
        await _store.HeartbeatAsync(TransaqSource, t0.AddSeconds(30), MaxGap, CancellationToken.None);

        // Пропущенные тики (разрыв > maxGap) = неявный обрыв → новый открытый интервал.
        await _store.HeartbeatAsync(TransaqSource, t0.AddMinutes(10), MaxGap, CancellationToken.None);

        var intervals = await _store.QueryAsync(
            new[] { TransaqSource }, t0.AddMinutes(-1), t0.AddMinutes(20), CancellationToken.None);

        intervals.Should().HaveCount(2);

        intervals[0].From.Should().Be(t0);
        intervals[0].To.Should().Be(t0.AddSeconds(30), "хартбиты в пределах maxGap двигают to_ts");
        intervals[0].Open.Should().BeFalse("старый интервал закрыт разрывом");

        intervals[1].From.Should().Be(t0.AddMinutes(10));
        intervals[1].To.Should().Be(t0.AddMinutes(10));
        intervals[1].Open.Should().BeTrue("последний интервал ещё живой");
    }

    [Fact]
    public async Task Close_ClosesOpenInterval()
    {
        var t0 = new DateTimeOffset(2026, 7, 8, 10, 0, 0, TimeSpan.Zero);
        await _store.HeartbeatAsync(TransaqSource, t0, MaxGap, CancellationToken.None);

        await _store.CloseAsync(TransaqSource, CancellationToken.None);

        var intervals = await _store.QueryAsync(
            new[] { TransaqSource }, t0.AddMinutes(-1), t0.AddMinutes(1), CancellationToken.None);
        intervals.Should().ContainSingle();
        intervals[0].Open.Should().BeFalse();
        intervals[0].To.Should().Be(t0, "to_ts замирает на последнем хартбите");
    }

    [Fact]
    public async Task Heartbeat_ReopensAfterClose()
    {
        var t0 = new DateTimeOffset(2026, 7, 8, 10, 0, 0, TimeSpan.Zero);
        await _store.HeartbeatAsync(TransaqSource, t0, MaxGap, CancellationToken.None);
        await _store.CloseAsync(TransaqSource, CancellationToken.None);

        // После закрытия следующий хартбит открывает новый интервал (инвариант uq на 1 открытый соблюдён).
        await _store.HeartbeatAsync(TransaqSource, t0.AddMinutes(5), MaxGap, CancellationToken.None);

        var intervals = await _store.QueryAsync(
            new[] { TransaqSource }, t0.AddMinutes(-1), t0.AddMinutes(10), CancellationToken.None);
        intervals.Should().HaveCount(2);
        intervals[1].From.Should().Be(t0.AddMinutes(5));
        intervals[1].Open.Should().BeTrue();
    }

    [Fact]
    public async Task RecoverOpenIntervalsAsync_ClosesOrphan()
    {
        var t0 = new DateTimeOffset(2026, 7, 8, 10, 0, 0, TimeSpan.Zero);
        await _store.HeartbeatAsync(TransaqSource, t0, MaxGap, CancellationToken.None);

        var recovered = await _store.RecoverOpenIntervalsAsync(CancellationToken.None);

        recovered.Should().Be(1);
        var intervals = await _store.QueryAsync(
            new[] { TransaqSource }, t0.AddMinutes(-1), t0.AddMinutes(1), CancellationToken.None);
        intervals[0].Open.Should().BeFalse("recovery на старте закрывает осиротевшие интервалы прошлого процесса");
    }

    [Fact]
    public async Task QueryAsync_ReturnsEmpty_ForNoSources()
    {
        var result = await _store.QueryAsync(
            Array.Empty<short>(), DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow, CancellationToken.None);

        result.Should().BeEmpty();
    }
}
