using Dapper;
using FluentAssertions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Storage.Timescale;

namespace Scinverse.Ohs.IntegrationTests;

/// <summary>Журнал инцидентов (incident, phase 11.13a): open / handover / resolve / query.</summary>
public sealed class IncidentStoreTests : IClassFixture<TimescaleFixture>, IAsyncLifetime
{
    private readonly TimescaleFixture _fixture;
    private readonly IncidentStore _store;

    public IncidentStoreTests(TimescaleFixture fixture)
    {
        _fixture = fixture;
        _store = new IncidentStore(fixture.DataSource);
    }

    public async Task InitializeAsync()
    {
        await using var connection = await _fixture.DataSource.OpenConnectionAsync();
        await connection.ExecuteAsync("TRUNCATE incident CASCADE;");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Open_is_idempotent_and_Get_returns_row()
    {
        var t0 = new DateTimeOffset(2026, 7, 29, 10, 0, 0, TimeSpan.Zero);
        var incident = BreakOpen("connection:3:link:abc", t0);

        (await _store.OpenAsync(incident, CancellationToken.None)).Should().BeTrue();
        (await _store.OpenAsync(incident, CancellationToken.None)).Should().BeFalse("second open = no-op");

        var got = await _store.GetAsync(incident.CorrUid, CancellationToken.None);
        got.Should().NotBeNull();
        got!.Status.Should().Be("active");
        got.Type.Should().Be("break");
        got.ConnectionId.Should().Be(3);
        got.OpenedAt.Should().Be(t0);
        got.ClosedAt.Should().BeNull();
    }

    [Fact]
    public async Task UpdateOpen_sets_escalated_and_recovering()
    {
        var t0 = new DateTimeOffset(2026, 7, 29, 11, 0, 0, TimeSpan.Zero);
        var corr = "connection:3:link:esc";
        await _store.OpenAsync(BreakOpen(corr, t0), CancellationToken.None);

        var esc = t0.AddSeconds(60);
        var updated = BreakOpen(corr, t0) with
        {
            Status = "recovering",
            EscalatedAt = esc,
            Subtype = "down",
            Owner = "supervisor",
            LastActivityAt = esc,
            Title = "handover",
        };
        (await _store.UpdateOpenAsync(updated, CancellationToken.None)).Should().BeTrue();

        var got = await _store.GetAsync(corr, CancellationToken.None);
        got!.Status.Should().Be("recovering");
        got.EscalatedAt.Should().Be(esc);
        got.Owner.Should().Be("supervisor");
        got.Subtype.Should().Be("down");
    }

    [Fact]
    public async Task Resolve_recovered_sets_terminal_fields()
    {
        var t0 = new DateTimeOffset(2026, 7, 29, 12, 0, 0, TimeSpan.Zero);
        var corr = "connection:3:link:ok";
        await _store.OpenAsync(BreakOpen(corr, t0), CancellationToken.None);

        var end = t0.AddMinutes(2);
        (await _store.ResolveAsync(corr, end, "recovered", "restored", "ok", resolvedBy: "superuser", CancellationToken.None))
            .Should().BeTrue();
        (await _store.ResolveAsync(corr, end.AddSeconds(1), "abandoned_manual", null, null, null, CancellationToken.None))
            .Should().BeFalse("already resolved");

        var got = await _store.GetAsync(corr, CancellationToken.None);
        got!.Status.Should().Be("resolved");
        got.CloseOutcome.Should().Be("recovered");
        got.ClosedAt.Should().Be(end);
        got.Title.Should().Be("restored");
        got.Severity.Should().Be("ok");
        got.Payload.Should().Contain("resolvedBy");
        got.Payload.Should().Contain("superuser");
    }

    [Fact]
    public async Task Resolve_abandoned_schedule_without_green_semantics()
    {
        var t0 = new DateTimeOffset(2026, 7, 29, 13, 0, 0, TimeSpan.Zero);
        var corr = "connection:3:link:aband";
        await _store.OpenAsync(BreakOpen(corr, t0), CancellationToken.None);

        var end = t0.AddHours(1);
        await _store.ResolveAsync(corr, end, "abandoned_schedule", null, "warning", null, CancellationToken.None);

        var got = await _store.GetAsync(corr, CancellationToken.None);
        got!.CloseOutcome.Should().Be("abandoned_schedule");
        got.ClosedAt.Should().Be(end);
    }

    [Fact]
    public async Task Query_filters_by_connection_and_window()
    {
        var day = new DateTimeOffset(2026, 7, 29, 0, 0, 0, TimeSpan.Zero);
        await _store.OpenAsync(BreakOpen("connection:1:link:a", day.AddHours(9), connectionId: 1), CancellationToken.None);
        await _store.OpenAsync(BreakOpen("connection:2:link:b", day.AddHours(10), connectionId: 2), CancellationToken.None);
        await _store.OpenAsync(
            BreakOpen("connection:1:link:c", day.AddHours(11), connectionId: 1) with { Type = "crash", Subtype = "host_unavailable" },
            CancellationToken.None);

        var forConn1 = await _store.QueryAsync(
            new IncidentQuery { ConnectionId = 1, Module = "connection", Limit = 50 },
            CancellationToken.None);
        forConn1.Should().HaveCount(2);
        forConn1.Select(i => i.CorrUid).Should().Equal("connection:1:link:c", "connection:1:link:a");

        // Закрытый до окна не попадает; open, начатый до From, пересекает окно (нужен на ribbon).
        await _store.ResolveAsync(
            "connection:1:link:a", day.AddHours(9).AddMinutes(30), "recovered", null, null, null, CancellationToken.None);

        var window = await _store.QueryAsync(
            new IncidentQuery
            {
                ConnectionId = 1,
                From = day.AddHours(10),
                To = day.AddHours(12),
            },
            CancellationToken.None);
        window.Should().ContainSingle().Which.CorrUid.Should().Be("connection:1:link:c");
    }

    [Fact]
    public async Task UpdateOpen_and_Resolve_no_op_when_missing()
    {
        var t0 = new DateTimeOffset(2026, 7, 29, 14, 0, 0, TimeSpan.Zero);
        (await _store.UpdateOpenAsync(BreakOpen("missing", t0), CancellationToken.None)).Should().BeFalse();
        (await _store.ResolveAsync("missing", t0, "recovered", null, null, null, CancellationToken.None))
            .Should().BeFalse();
    }

    [Fact]
    public async Task ReplaceConnectionScope_and_Query_via_join()
    {
        // P5: crash без connection_id на строке; scope → incident_connection.
        await using var db = await _fixture.DataSource.OpenConnectionAsync();
        var a = await db.ExecuteScalarAsync<long>(
            """
            INSERT INTO connector_connection (source_id, name, kind, settings)
            VALUES (2, @name, 'synthetic', '{}')
            RETURNING connection_id;
            """,
            new { name = $"test-scope-a-{Guid.NewGuid():N}" });
        var b = await db.ExecuteScalarAsync<long>(
            """
            INSERT INTO connector_connection (source_id, name, kind, settings)
            VALUES (2, @name, 'synthetic', '{}')
            RETURNING connection_id;
            """,
            new { name = $"test-scope-b-{Guid.NewGuid():N}" });

        var t0 = new DateTimeOffset(2026, 8, 1, 10, 0, 0, TimeSpan.Zero);
        var corr = "ohs.backend.outage:1001";
        var crash = new Incident
        {
            CorrUid = corr,
            Module = "connection",
            Type = "crash",
            Status = "active",
            OpenedAt = t0,
            Subject = "ohs.backend.outage:1001",
            Severity = "critical",
            Title = "host down",
            LastActivityAt = t0,
            ConnectionId = null,
            Subtype = "host_unavailable",
            Owner = "admin",
        };
        (await _store.OpenAsync(crash, CancellationToken.None)).Should().BeTrue();

        await _store.ReplaceConnectionScopeAsync(corr, [a, b], CancellationToken.None);
        (await _store.ListConnectionScopeAsync(corr, CancellationToken.None))
            .Should().Equal(new[] { a, b }.OrderBy(x => x).ToArray());

        var forB = await _store.QueryAsync(
            new IncidentQuery { ConnectionId = b, Module = "connection", Limit = 50 },
            CancellationToken.None);
        forB.Should().ContainSingle(i => i.CorrUid == corr);

        var forA = await _store.QueryAsync(
            new IncidentQuery { ConnectionId = a, Module = "connection", Limit = 50 },
            CancellationToken.None);
        forA.Should().ContainSingle(i => i.CorrUid == corr);

        await _store.ReplaceConnectionScopeAsync(corr, [b], CancellationToken.None);
        (await _store.ListConnectionScopeAsync(corr, CancellationToken.None)).Should().Equal(b);

        var after = await _store.QueryAsync(
            new IncidentQuery { ConnectionId = a, Module = "connection", Limit = 50 },
            CancellationToken.None);
        after.Should().NotContain(i => i.CorrUid == corr);
    }

    private static Incident BreakOpen(
        string corr, DateTimeOffset at, long connectionId = 3) => new()
    {
        CorrUid = corr,
        Module = "connection",
        Type = "break",
        Status = "active",
        OpenedAt = at,
        Subject = corr.Contains(':') ? string.Join(':', corr.Split(':').Take(3)) : corr,
        Severity = "error",
        Title = "lost",
        LastActivityAt = at,
        ConnectionId = connectionId,
        SourceId = 1,
        Subtype = "degraded",
        Owner = "transaq",
    };
}
