using Dapper;
using FluentAssertions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Storage.Timescale;

namespace Scinverse.Ohs.IntegrationTests;

/// <summary>
/// Долговременный аудит-лог уведомлений (notification, V025, phase 11.2): пакетная append-запись
/// (идемпотентная по event_id), чтение последних N oldest-first, round-trip актор-следа и осей
/// атрибуции (interaction/localization), jsonb data.
/// </summary>
public sealed class NotificationStoreTests : IClassFixture<TimescaleFixture>, IAsyncLifetime
{
    private readonly TimescaleFixture _fixture;
    private readonly NotificationStore _store;

    public NotificationStoreTests(TimescaleFixture fixture)
    {
        _fixture = fixture;
        _store = new NotificationStore(fixture.DataSource);
    }

    public async Task InitializeAsync()
    {
        await using var connection = await _fixture.DataSource.OpenConnectionAsync();
        await connection.ExecuteAsync("TRUNCATE notification;");
        await connection.ExecuteAsync("TRUNCATE incident CASCADE;");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static readonly DateTimeOffset T0 = new(2026, 7, 20, 10, 0, 0, TimeSpan.Zero);

    private static NotificationRecord Rec(
        DateTimeOffset ts, string message, string sourceType = "user", string? data = null,
        string? subject = null, string? correlationId = null, Guid? id = null,
        string? status = null, string code = "connection.schedule.rule_set") => new()
    {
        EventId = id ?? Guid.NewGuid(),
        Ts = ts,
        Severity = "info",
        SourceType = sourceType,
        Interaction = sourceType == "user" ? "user" : "system",
        Localization = sourceType == "external" ? "external" : "internal",
        Status = status,
        Module = "ohs.connection",
        Code = code,
        Message = message,
        Subject = subject,
        CorrelationId = correlationId,
        ActorKind = sourceType,
        ActorId = sourceType == "user" ? "superuser" : "ohs.connection",
        ActorLabel = sourceType == "user" ? "Оператор" : "ohs.connection",
        Data = data,
    };

    [Fact]
    public async Task AppendBatch_thenQueryRecent_returnsOldestFirst_withRoundTrip()
    {
        // Порядок вставки перемешан — важно, что чтение сортирует по ts (oldest-first).
        await _store.AppendBatchAsync(new[]
        {
            Rec(T0.AddSeconds(2), "third"),
            Rec(T0, "first", data: """{"connectionId":3}"""),
            Rec(T0.AddSeconds(1), "second", sourceType: "external"),
        }, CancellationToken.None);

        var recent = await _store.QueryRecentAsync(10, CancellationToken.None);

        recent.Select(r => r.Message).Should().Equal("first", "second", "third");

        var first = recent[0];
        first.Ts.Should().Be(T0);
        first.Interaction.Should().Be("user");
        first.Localization.Should().Be("internal");
        first.ActorKind.Should().Be("user");
        first.ActorId.Should().Be("superuser");
        first.ActorLabel.Should().Be("Оператор");
        first.Data.Should().NotBeNull();
        first.Data.Should().Contain("connectionId");

        var external = recent[1];
        external.Interaction.Should().Be("system");
        external.Localization.Should().Be("external");
        external.ActorKind.Should().Be("external");
    }

    [Fact]
    public async Task AppendBatch_isIdempotent_onDuplicateEventId()
    {
        var id = Guid.NewGuid();
        await _store.AppendBatchAsync(new[] { Rec(T0, "once", id: id) }, CancellationToken.None);
        // Повторная доставка того же события (реконнект/replay) не должна плодить строку.
        await _store.AppendBatchAsync(new[] { Rec(T0, "again", id: id) }, CancellationToken.None);

        var recent = await _store.QueryRecentAsync(10, CancellationToken.None);
        recent.Should().ContainSingle();
        recent[0].Message.Should().Be("once", "ON CONFLICT DO NOTHING — первая запись выигрывает");
    }

    [Fact]
    public async Task QueryRecent_limitsToNewestN_oldestFirst()
    {
        var records = Enumerable.Range(0, 5)
            .Select(i => Rec(T0.AddSeconds(i), $"m{i}"))
            .ToArray();
        await _store.AppendBatchAsync(records, CancellationToken.None);

        var recent = await _store.QueryRecentAsync(3, CancellationToken.None);

        // Последние 3 по времени (m2,m3,m4), но отданы oldest-first.
        recent.Select(r => r.Message).Should().Equal("m2", "m3", "m4");
    }

    [Fact]
    public async Task AppendBatch_empty_isNoop()
    {
        await _store.AppendBatchAsync(Array.Empty<NotificationRecord>(), CancellationToken.None);
        (await _store.QueryRecentAsync(10, CancellationToken.None)).Should().BeEmpty();
    }

    [Fact]
    public async Task FindOpenLinkIncident_returnsLatestOpenCorr_withOpenedAt()
    {
        const long connectionId = 3;
        const string subject = "connection:3:link";
        const string openCorr = "connection:3:link:aaaaaaaa";
        const string closedCorr = "connection:3:link:bbbbbbbb";

        await _store.AppendBatchAsync(new[]
        {
            // Закрытый более ранний break — не должен вернуться.
            Rec(T0, "lost-old", sourceType: "system", subject: subject, correlationId: closedCorr,
                status: "active", code: "connection.lost"),
            Rec(T0.AddMinutes(5), "recovered-old", sourceType: "system", subject: subject,
                correlationId: closedCorr, status: "resolved", code: "connection.recovered"),
            // Открытый break: open + progress; OpenedAt = первый ts.
            Rec(T0.AddHours(1), "lost", sourceType: "system", subject: subject, correlationId: openCorr,
                status: "active", code: "connection.lost"),
            Rec(T0.AddHours(1).AddMinutes(2), "reconnecting", sourceType: "system", subject: subject,
                correlationId: openCorr, status: "underway", code: "connection.reconnecting"),
            // Чужой subject / crash — игнор.
            Rec(T0.AddHours(1).AddMinutes(3), "crash", sourceType: "system",
                subject: "ohs.backend.outage", correlationId: "ohs.backend.outage:1",
                status: "active", code: "backend.unavailable"),
        }, CancellationToken.None);

        var open = await _store.FindOpenLinkIncidentAsync(connectionId, CancellationToken.None);

        open.Should().NotBeNull();
        open!.CorrelationId.Should().Be(openCorr);
        open.Status.Should().Be("underway");
        open.OpenedAt.Should().Be(T0.AddHours(1));
    }

    [Fact]
    public async Task FindOpenLinkIncident_whenResolved_returnsNull()
    {
        const string subject = "connection:9:link";
        const string corr = "connection:9:link:cccccccc";
        await _store.AppendBatchAsync(new[]
        {
            Rec(T0, "lost", sourceType: "system", subject: subject, correlationId: corr,
                status: "active", code: "connection.lost"),
            Rec(T0.AddMinutes(1), "closed", sourceType: "system", subject: subject, correlationId: corr,
                status: "resolved", code: "connection.incident_closed"),
        }, CancellationToken.None);

        (await _store.FindOpenLinkIncidentAsync(9, CancellationToken.None)).Should().BeNull();
        (await _store.FindOpenLinkIncidentAsync(3, CancellationToken.None)).Should().BeNull();
    }

    [Fact]
    public async Task QueryRecent_excludes_atoms_of_soft_deleted_incident()
    {
        const string deletedCorr = "connection:3:link:gone";
        const string liveCorr = "connection:3:link:live";
        await _store.AppendBatchAsync(new[]
        {
            Rec(T0, "deleted-episode", sourceType: "system", subject: "connection:3:link",
                correlationId: deletedCorr, status: "resolved", code: "connection.incident_closed"),
            Rec(T0.AddSeconds(1), "live-episode", sourceType: "system", subject: "connection:3:link",
                correlationId: liveCorr, status: "resolved", code: "connection.incident_closed"),
            Rec(T0.AddSeconds(2), "single-no-corr", sourceType: "user"),
        }, CancellationToken.None);

        await using (var db = await _fixture.DataSource.OpenConnectionAsync())
        {
            await db.ExecuteAsync(
                """
                INSERT INTO incident (
                    corr_uid, module, type, status, close_outcome,
                    opened_at, closed_at, subject, severity, title, last_activity_at,
                    connection_id, deleted_at, deleted_by)
                VALUES (
                    @corr, 'connection', 'break', 'resolved', 'recovered',
                    @t0, @t1, 'connection:3:link', 'ok', 'gone', @t1,
                    3, @delAt, 'superuser');
                """,
                new
                {
                    corr = deletedCorr,
                    t0 = T0.UtcDateTime,
                    t1 = T0.AddMinutes(1).UtcDateTime,
                    delAt = T0.AddMinutes(2).UtcDateTime,
                });
        }

        var recent = await _store.QueryRecentAsync(20, CancellationToken.None);
        recent.Select(r => r.Message).Should().Equal("live-episode", "single-no-corr");
        recent.Should().NotContain(r => r.CorrelationId == deletedCorr);

        var byCorr = await _store.QueryByCorrelationIdAsync(deletedCorr, CancellationToken.None);
        byCorr.Should().ContainSingle().Which.Message.Should().Be("deleted-episode");
    }
}
