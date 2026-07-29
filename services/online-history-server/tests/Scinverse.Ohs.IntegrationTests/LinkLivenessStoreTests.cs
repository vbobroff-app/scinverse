using Dapper;
using FluentAssertions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Storage.Timescale;

namespace Scinverse.Ohs.IntegrationTests;

/// <summary>
/// Жизненный цикл связи (link_liveness, phase 7h.8): интервалы «связь жива» на подключение, НЕЗАВИСИМО от
/// записи. Keepalive продлевает открытый интервал; больший разрыв рвёт на два (interrupted); Close/Recover
/// закрывают с причиной. Отличие от capture: журнал периодов «связь не жива» ВКЛЮЧАЕТ добровольный
/// <see cref="LinkCloseReason.Disconnected"/> (серый на ленте) — исключается только... ничего (все причины).
/// </summary>
public sealed class LinkLivenessStoreTests : IClassFixture<TimescaleFixture>, IAsyncLifetime
{
    private const short TransaqSource = 1;
    private static readonly TimeSpan MaxGap = TimeSpan.FromSeconds(45);

    private readonly TimescaleFixture _fixture;
    private readonly LinkLivenessStore _store;

    public LinkLivenessStoreTests(TimescaleFixture fixture)
    {
        _fixture = fixture;
        _store = new LinkLivenessStore(fixture.DataSource);
    }

    public async Task InitializeAsync()
    {
        await using var connection = await _fixture.DataSource.OpenConnectionAsync();
        await connection.ExecuteAsync("TRUNCATE link_liveness;");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Heartbeat_ExtendsWithinGap_AndSplitsOnLargeGap()
    {
        var t0 = new DateTimeOffset(2026, 7, 8, 10, 0, 0, TimeSpan.Zero);

        await _store.HeartbeatAsync(TransaqSource, t0, MaxGap, CancellationToken.None);
        await _store.HeartbeatAsync(TransaqSource, t0.AddSeconds(15), MaxGap, CancellationToken.None);
        await _store.HeartbeatAsync(TransaqSource, t0.AddSeconds(30), MaxGap, CancellationToken.None);

        // Пропущенные keepalive-тики (> maxGap) = неявный обрыв процесса → новый открытый интервал.
        await _store.HeartbeatAsync(TransaqSource, t0.AddMinutes(10), MaxGap, CancellationToken.None);

        var intervals = await _store.QueryAsync(
            new[] { TransaqSource }, t0.AddMinutes(-1), t0.AddMinutes(20), CancellationToken.None);

        intervals.Should().HaveCount(2);
        intervals[0].From.Should().Be(t0);
        intervals[0].To.Should().Be(t0.AddSeconds(30));
        intervals[0].Open.Should().BeFalse();
        intervals[0].CloseReason.Should().Be(LinkCloseReason.Interrupted, "split по пропуску keepalive");
        intervals[1].From.Should().Be(t0.AddMinutes(10));
        intervals[1].Open.Should().BeTrue();
    }

    [Fact]
    public async Task Close_Disconnected_ClosesOpenInterval()
    {
        var t0 = new DateTimeOffset(2026, 7, 8, 10, 0, 0, TimeSpan.Zero);
        await _store.HeartbeatAsync(TransaqSource, t0, MaxGap, CancellationToken.None);

        await _store.CloseAsync(TransaqSource, LinkCloseReason.Disconnected, null, CancellationToken.None);

        var intervals = await _store.QueryAsync(
            new[] { TransaqSource }, t0.AddMinutes(-1), t0.AddMinutes(1), CancellationToken.None);
        intervals.Should().ContainSingle();
        intervals[0].Open.Should().BeFalse();
        intervals[0].CloseReason.Should().Be(LinkCloseReason.Disconnected);
        intervals[0].To.Should().Be(t0, "без atTs to_ts замирает на последнем keepalive");
    }

    [Fact]
    public async Task Close_ServerDown_ShiftsToTsToExactEventTime()
    {
        var t0 = new DateTimeOffset(2026, 7, 8, 10, 0, 0, TimeSpan.Zero);
        await _store.HeartbeatAsync(TransaqSource, t0, MaxGap, CancellationToken.None);

        var failTs = t0.AddSeconds(40);
        await _store.CloseAsync(TransaqSource, LinkCloseReason.ServerDown, failTs, CancellationToken.None);

        var intervals = await _store.QueryAsync(
            new[] { TransaqSource }, t0.AddMinutes(-1), t0.AddMinutes(1), CancellationToken.None);
        intervals[0].To.Should().Be(failTs, "atTs сдвигает to_ts на точное время обрыва");
        intervals[0].CloseReason.Should().Be(LinkCloseReason.ServerDown);
    }

    [Fact]
    public async Task RecoverOpenIntervalsAsync_ClosesOrphan_AsInterrupted()
    {
        var t0 = new DateTimeOffset(2026, 7, 8, 10, 0, 0, TimeSpan.Zero);
        await _store.HeartbeatAsync(TransaqSource, t0, MaxGap, CancellationToken.None);

        var recovered = await _store.RecoverOpenIntervalsAsync(CancellationToken.None);

        recovered.Should().Be(1);
        var intervals = await _store.QueryAsync(
            new[] { TransaqSource }, t0.AddMinutes(-1), t0.AddMinutes(1), CancellationToken.None);
        intervals[0].Open.Should().BeFalse();
        intervals[0].CloseReason.Should().Be(LinkCloseReason.Interrupted);
    }

    [Fact]
    public async Task QueryGaps_IncludesDisconnected_AndServerDown()
    {
        var t0 = new DateTimeOffset(2026, 7, 8, 10, 0, 0, TimeSpan.Zero);

        // A: обрыв связи в t0+30s (красный).
        await _store.HeartbeatAsync(TransaqSource, t0, MaxGap, CancellationToken.None);
        await _store.CloseAsync(TransaqSource, LinkCloseReason.ServerDown, t0.AddSeconds(30), CancellationToken.None);
        // B: реконнект в t0+2m, пользователь отключил провайдера в t0+3m (серый, но ВСЁ РАВНО период «не жива»).
        await _store.HeartbeatAsync(TransaqSource, t0.AddMinutes(2), MaxGap, CancellationToken.None);
        await _store.CloseAsync(TransaqSource, LinkCloseReason.Disconnected, t0.AddMinutes(3), CancellationToken.None);
        // C: снова подключились, связь жива.
        await _store.HeartbeatAsync(TransaqSource, t0.AddMinutes(5), MaxGap, CancellationToken.None);

        var gaps = await _store.QueryGapsAsync(
            new[] { TransaqSource }, t0.AddMinutes(-1), t0.AddMinutes(20), CancellationToken.None);

        gaps.Should().HaveCount(2, "оба периода «связь не жива»: server_down и disconnected");
        gaps[0].From.Should().Be(t0.AddSeconds(30));
        gaps[0].To.Should().Be(t0.AddMinutes(2));
        gaps[0].Cause.Should().Be(LinkCloseReason.ServerDown);
        gaps[1].From.Should().Be(t0.AddMinutes(3));
        gaps[1].To.Should().Be(t0.AddMinutes(5), "конец = реконнект");
        gaps[1].Cause.Should().Be(LinkCloseReason.Disconnected);
    }

    [Fact]
    public async Task QueryGaps_OngoingGap_HasNullTo()
    {
        var t0 = new DateTimeOffset(2026, 7, 8, 10, 0, 0, TimeSpan.Zero);
        await _store.HeartbeatAsync(TransaqSource, t0, MaxGap, CancellationToken.None);
        await _store.CloseAsync(TransaqSource, LinkCloseReason.ServerDown, null, CancellationToken.None);

        var gaps = await _store.QueryGapsAsync(
            new[] { TransaqSource }, t0.AddMinutes(-1), t0.AddMinutes(10), CancellationToken.None);

        gaps.Should().ContainSingle();
        gaps[0].From.Should().Be(t0);
        gaps[0].To.Should().BeNull("следующего интервала нет — связь так и не поднялась");
        gaps[0].Cause.Should().Be(LinkCloseReason.ServerDown);
    }

    [Fact]
    public async Task Handover_MarkerSplitsColorButKeepsOneGap_AndIsHiddenFromIntervals()
    {
        var t0 = new DateTimeOffset(2026, 7, 8, 10, 0, 0, TimeSpan.Zero);

        // Live → keepalive; вход в Degraded в t0+30s (жёлтая дырка, владелец TRANSAQ).
        await _store.HeartbeatAsync(TransaqSource, t0, MaxGap, CancellationToken.None);
        await _store.HeartbeatAsync(TransaqSource, t0.AddSeconds(15), MaxGap, CancellationToken.None);
        await _store.CloseAsync(TransaqSource, LinkCloseReason.Degraded, t0.AddSeconds(30), CancellationToken.None);
        // Передача владения супервизору в t0+90s (grace 60c): нулевой маркер server_down.
        await _store.InsertBoundaryMarkerAsync(TransaqSource, LinkCloseReason.ServerDown, t0.AddSeconds(90), CancellationToken.None);
        // Восстановление в t0+120s: новый живой интервал.
        await _store.HeartbeatAsync(TransaqSource, t0.AddSeconds(120), MaxGap, CancellationToken.None);

        var gaps = await _store.QueryGapsAsync(
            new[] { TransaqSource }, t0.AddMinutes(-1), t0.AddMinutes(20), CancellationToken.None);

        // Простой = ОДНА дырка [start Degraded → восстановление] (для сверки с записанными данными).
        gaps.Should().ContainSingle("маркер владельца склеивается — инцидент = одна дырка");
        gaps[0].From.Should().Be(t0.AddSeconds(30));
        gaps[0].To.Should().Be(t0.AddSeconds(120), "конец = восстановление, весь простой целиком");
        gaps[0].Cause.Should().Be(LinkCloseReason.Degraded, "начальный владелец = TRANSAQ (жёлтый)");
        // Момент передачи — только для раскраски ленты (жёлтое→красное), не рвёт дырку.
        gaps[0].EscalatedAt.Should().Be(t0.AddSeconds(90));
        gaps[0].EscalatedCause.Should().Be(LinkCloseReason.ServerDown, "после передачи — супервизор (красный)");

        // Маркер владельца — нулевой интервал (from==to, server_down); реальные интервалы целы. Рендер
        // нулевой ширины отсекает фронт (J7), контракт QueryAsync не меняем (легитимные single-tick тоже
        // нулевые — их нельзя отличить по геометрии).
        var intervals = await _store.QueryAsync(
            new[] { TransaqSource }, t0.AddMinutes(-1), t0.AddMinutes(20), CancellationToken.None);
        intervals.Should().HaveCount(3);
        intervals.Should().Contain(i => i.CloseReason == LinkCloseReason.Degraded && i.From == t0);
        intervals.Should().Contain(i => i.Open && i.From == t0.AddSeconds(120));
        intervals.Should().Contain(
            i => !i.Open && i.From == i.To && i.From == t0.AddSeconds(90) && i.CloseReason == LinkCloseReason.ServerDown);
    }

    [Fact]
    public async Task ScheduleEnd_MarkerAbandonsBreakGap_WithoutMergingIntoGrey()
    {
        var t0 = new DateTimeOffset(2026, 7, 8, 10, 0, 0, TimeSpan.Zero);

        await _store.HeartbeatAsync(TransaqSource, t0, MaxGap, CancellationToken.None);
        await _store.CloseAsync(TransaqSource, LinkCloseReason.Degraded, t0.AddHours(1), CancellationToken.None);
        // Конец окна расписания: нулевой маркер scheduled → клип break (Abandoned), без green на фронте.
        await _store.InsertBoundaryMarkerAsync(
            TransaqSource, LinkCloseReason.Scheduled, t0.AddHours(3), CancellationToken.None);
        // Следующее утро — новый Live.
        await _store.HeartbeatAsync(TransaqSource, t0.AddHours(12), MaxGap, CancellationToken.None);

        var gaps = await _store.QueryGapsAsync(
            new[] { TransaqSource }, t0.AddMinutes(-1), t0.AddDays(1), CancellationToken.None);

        gaps.Should().HaveCount(2, "break (abandoned) + серый idle до следующего Live");
        gaps[0].Cause.Should().Be(LinkCloseReason.Degraded);
        gaps[0].From.Should().Be(t0.AddHours(1));
        gaps[0].To.Should().Be(t0.AddHours(3));
        gaps[0].Abandoned.Should().BeTrue();
        gaps[0].EscalatedAt.Should().BeNull("scheduled-маркер — не handover");
        gaps[1].Cause.Should().Be(LinkCloseReason.Scheduled);
        gaps[1].From.Should().Be(t0.AddHours(3));
        gaps[1].To.Should().Be(t0.AddHours(12));
        gaps[1].Abandoned.Should().BeFalse();
    }

    [Fact]
    public async Task CatchUpMarker_AfterLongDegraded_ThenLive_SetsEscalatedAtAtT()
    {
        // Live после ~33 мин Degraded без grace-tick: catch-up boundary на since+T → жёлтое ≤ T.
        var t0 = new DateTimeOffset(2026, 7, 28, 6, 44, 49, TimeSpan.Zero);
        var grace = TimeSpan.FromSeconds(60);
        var liveAt = t0.AddMinutes(33);

        await _store.HeartbeatAsync(TransaqSource, t0.AddMinutes(-5), MaxGap, CancellationToken.None);
        await _store.CloseAsync(TransaqSource, LinkCloseReason.Degraded, t0, CancellationToken.None);
        await _store.InsertBoundaryMarkerAsync(
            TransaqSource, LinkCloseReason.ServerDown, t0.Add(grace), CancellationToken.None);
        await _store.HeartbeatAsync(TransaqSource, liveAt, MaxGap, CancellationToken.None);

        var gaps = await _store.QueryGapsAsync(
            new[] { TransaqSource }, t0.AddMinutes(-1), liveAt.AddMinutes(1), CancellationToken.None);

        gaps.Should().ContainSingle();
        gaps[0].From.Should().Be(t0);
        gaps[0].To.Should().Be(liveAt);
        gaps[0].Cause.Should().Be(LinkCloseReason.Degraded);
        gaps[0].EscalatedAt.Should().Be(t0.Add(grace));
        gaps[0].EscalatedCause.Should().Be(LinkCloseReason.ServerDown);
    }

    [Fact]
    public async Task NaturalDownAfterDegraded_ThenScheduleEnd_SplitsYellowThenRed_Abandoned()
    {
        // Кейс hard-down→timeout: Degraded → Down (~40 с) → schedule_end. Без маркера server_down
        // на Down вся дыра остаётся жёлтой (баг ленты).
        var t0 = new DateTimeOffset(2026, 7, 26, 12, 50, 0, TimeSpan.Zero); // 15:50 МСК

        await _store.HeartbeatAsync(TransaqSource, t0.AddMinutes(-10), MaxGap, CancellationToken.None);
        await _store.CloseAsync(TransaqSource, LinkCloseReason.Degraded, t0, CancellationToken.None);
        await _store.InsertBoundaryMarkerAsync(
            TransaqSource, LinkCloseReason.ServerDown, t0.AddSeconds(41), CancellationToken.None);
        await _store.InsertBoundaryMarkerAsync(
            TransaqSource, LinkCloseReason.Scheduled, t0.AddMinutes(10), CancellationToken.None);
        await _store.HeartbeatAsync(TransaqSource, t0.AddHours(1), MaxGap, CancellationToken.None);

        var gaps = await _store.QueryGapsAsync(
            new[] { TransaqSource }, t0.AddMinutes(-1), t0.AddHours(2), CancellationToken.None);

        gaps.Should().HaveCount(2, "break (abandoned) + серый idle до Live");
        gaps[0].From.Should().Be(t0);
        gaps[0].To.Should().Be(t0.AddMinutes(10));
        gaps[0].Cause.Should().Be(LinkCloseReason.Degraded);
        gaps[0].EscalatedAt.Should().Be(t0.AddSeconds(41), "натуральный Down = граница жёлтый→красный");
        gaps[0].EscalatedCause.Should().Be(LinkCloseReason.ServerDown);
        gaps[0].Abandoned.Should().BeTrue();
    }

    [Fact]
    public async Task QueryAsync_ReturnsEmpty_ForNoSources()
    {
        var result = await _store.QueryAsync(
            Array.Empty<short>(), DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow, CancellationToken.None);

        result.Should().BeEmpty();
    }
}
