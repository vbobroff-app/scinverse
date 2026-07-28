using System.Text.Json;
using FluentAssertions;
using Scinverse.Ohs.Host;

namespace Scinverse.Ohs.UnitTests;

/// <summary>Оркестратор жизненного цикла (ось B, 11.2): переходы + идемпотентность под lock.</summary>
public sealed class NotificationHubTests
{
    private static NotificationHub NewHub() => new(new WebSocketBroadcaster());

    private static string? DataString(NotificationDto evt, string key)
    {
        if (evt.Data is not { } data || data.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return data.TryGetProperty(key, out var p) && p.ValueKind == JsonValueKind.String
            ? p.GetString()
            : null;
    }

    [Fact]
    public void Open_progress_resolve_transitions_and_isIdempotent()
    {
        var hub = NewHub();
        const string subject = "connection:1:link";

        hub.Open(subject, "connection.lost", "down").Should().BeTrue();
        hub.Open(subject, "connection.lost", "down").Should().BeFalse("повторный open активного — no-op");

        hub.Progress(subject, "connection.reconnecting", "retry").Should().BeTrue();
        hub.Open(subject, "connection.lost", "escalated").Should().BeFalse(
            "после Progress Open запрещён — иначе схлопывался первый lost; эскалация через Append");
        hub.Append(subject, "connection.lost", "связь потеряна (Down)", severity: "error").Should().BeTrue();
        hub.Progress(subject, "connection.reconnecting", "retry 2").Should().BeTrue(
            "прогресс-тик повторяем (7j.20 J5): underway→underway пишет новую строку");

        hub.Resolve(subject, "connection.recovered", "up").Should().BeTrue();
        hub.Resolve(subject, "connection.recovered", "up").Should().BeFalse("инцидент уже закрыт — no-op");

        var list = hub.List();
        list.Select(e => e.Code).Should().Equal(
            "connection.lost",
            "connection.reconnecting",
            "connection.lost",
            "connection.reconnecting",
            "connection.recovered");

        var ids = list.Select(e => e.CorrelationId).Distinct().ToList();
        ids.Should().ContainSingle();
        ids[0].Should().StartWith(subject + ":");
        ids[0]!.Length.Should().BeGreaterThan(subject.Length + 1, "после subject: должен идти uid");
    }

    [Fact]
    public void Append_withoutOpenIncident_isNoop()
    {
        var hub = NewHub();
        hub.Append("c", "connection.lost", "down").Should().BeFalse();
        hub.List().Should().BeEmpty();
    }

    [Fact]
    public void Progress_withoutOpenIncident_isNoop()
    {
        var hub = NewHub();
        hub.Progress("c", "connection.reconnecting", "retry").Should().BeFalse();
        hub.List().Should().BeEmpty();
    }

    [Fact]
    public void Adopt_seedsOpenIncident_withoutEmitting_thenProgressResolveReuseCorr()
    {
        var hub = NewHub();
        const string subject = "connection:3:link";
        const string corr = "connection:3:link:deadbeef";

        hub.Adopt(subject, corr, "active").Should().BeTrue();
        hub.List().Should().BeEmpty("Adopt не пишет строку в ленту");

        hub.Progress(subject, "connection.reconnecting", "retry").Should().BeTrue();
        hub.Resolve(subject, "connection.recovered", "up").Should().BeTrue();

        var list = hub.List();
        list.Select(e => e.Code).Should().Equal("connection.reconnecting", "connection.recovered");
        list.Should().OnlyContain(e => e.CorrelationId == corr);
    }

    [Fact]
    public void Adopt_sameCorr_isIdempotent_foreignCorr_rejected()
    {
        var hub = NewHub();
        const string subject = "connection:3:link";

        hub.Adopt(subject, "connection:3:link:aaaa1111", "underway").Should().BeTrue();
        hub.Adopt(subject, "connection:3:link:aaaa1111", "underway").Should().BeTrue("тот же corr");
        hub.Adopt(subject, "connection:3:link:bbbb2222", "active").Should().BeFalse("чужой corr не перетираем");
        hub.Adopt(subject, "connection:3:link:cccc3333", "resolved").Should().BeFalse("status resolved недопустим");
    }

    [Fact]
    public void Forget_rollsBackAdopt_withoutEmitting_thenOpenAllowed()
    {
        var hub = NewHub();
        const string subject = "connection:4:link";
        const string corr = "connection:4:link:dddd4444";

        hub.Adopt(subject, corr, "active").Should().BeTrue();
        hub.Forget(subject, corr).Should().BeTrue();
        hub.List().Should().BeEmpty("Forget не пишет NC");
        hub.Progress(subject, "connection.reconnecting", "x").Should().BeFalse("после Forget open нет");
        hub.Open(subject, "connection.lost", "down").Should().BeTrue("Hub снова свободен");
        hub.Forget(subject, "connection:4:link:other").Should().BeFalse("чужой corr не снимаем");
    }

    [Fact]
    public void Resolve_withoutOpenIncident_isNoop()
    {
        var hub = NewHub();
        hub.Resolve("c", "connection.recovered", "up").Should().BeFalse();
        hub.List().Should().BeEmpty();
    }

    [Fact]
    public void Reopen_afterResolve_startsNewIncident_withNewCorrelationId()
    {
        var hub = NewHub();
        const string subject = "connection:7:link";

        hub.Open(subject, "connection.lost", "down").Should().BeTrue();
        hub.Resolve(subject, "connection.recovered", "up").Should().BeTrue();
        hub.Open(subject, "connection.lost", "down again").Should().BeTrue("после resolved инцидент можно открыть заново");

        var list = hub.List();
        list.Select(e => e.Status).Should().Equal("active", "resolved", "active");

        // Первый инцидент (open+resolve) — один uid; повторный open — новый uid (истории не смешиваются).
        list[0].CorrelationId.Should().Be(list[1].CorrelationId, "open и resolve одного инцидента делят correlationId");
        list[2].CorrelationId.Should().NotBe(list[0].CorrelationId, "повторно открытый инцидент получает новый uid");
        list.Select(e => e.CorrelationId).Should().OnlyContain(id => id!.StartsWith(subject + ":"));
    }

    [Fact]
    public void Publish_singleEvent_hasNoLifecycle()
    {
        var hub = NewHub();
        hub.Publish("connection.schedule_disconnect", "off");

        var evt = hub.List().Should().ContainSingle().Subject;
        evt.Status.Should().BeNull();
        evt.CorrelationId.Should().BeNull();
    }

    [Fact]
    public void Open_enriches_threadKindHint_incident_by_default()
    {
        var hub = NewHub();
        hub.Open("connection:1:link", "connection.lost", "down", severity: "error");

        var open = hub.List().Should().ContainSingle().Subject;
        DataString(open, "threadKindHint").Should().Be(NotificationThreadData.KindIncident);
    }

    [Fact]
    public void Open_preserves_explicit_threadKindHint_group()
    {
        var hub = NewHub();
        hub.Open(
            "connection:1:link",
            "connection.lost",
            "down",
            severity: "error",
            data: new { threadKindHint = NotificationThreadData.KindGroup, sender = "test" });

        var open = hub.List().Should().ContainSingle().Subject;
        DataString(open, "threadKindHint").Should().Be(NotificationThreadData.KindGroup);
        DataString(open, "sender").Should().Be("test");
    }

    [Fact]
    public void Resolve_enriches_closeOutcome_recovered_and_abandoned_schedule()
    {
        var hub = NewHub();
        hub.Open("connection:1:link", "connection.lost", "down", severity: "error");
        hub.Resolve("connection:1:link", "connection.recovered", "up", severity: "ok");

        var recovered = hub.List().Last(e => e.Code == "connection.recovered");
        DataString(recovered, "closeOutcome").Should().Be(NotificationThreadData.OutcomeRecovered);

        hub.Open("connection:2:link", "connection.lost", "down", severity: "error");
        hub.Resolve(
            "connection:2:link",
            "connection.incident_closed",
            "schedule end",
            severity: "warning",
            data: new { reason = "schedule_end" });

        var abandoned = hub.List().Last(e => e.Code == "connection.incident_closed");
        DataString(abandoned, "closeOutcome").Should().Be(NotificationThreadData.OutcomeAbandonedSchedule);
    }

    [Fact]
    public void Resolve_enriches_closeOutcome_abandoned_manual_from_reason()
    {
        var hub = NewHub();
        hub.Open("connection:3:link", "connection.lost", "down", severity: "error");
        hub.Resolve(
            "connection:3:link",
            "connection.incident_closed",
            "manual off",
            severity: "warning",
            data: new { reason = "manual_off" });

        var closed = hub.List().Last(e => e.Code == "connection.incident_closed");
        DataString(closed, "closeOutcome").Should().Be(NotificationThreadData.OutcomeAbandonedManual);
    }

    [Fact]
    public void Ingest_enriches_json_data_with_thread_hints()
    {
        var hub = NewHub();
        var openData = JsonSerializer.SerializeToElement(new { sender = "client", kind = "crash" });
        hub.Ingest(
            id: Guid.NewGuid().ToString("N"),
            ts: DateTimeOffset.UtcNow,
            code: "backend.unavailable",
            message: "down",
            severity: "critical",
            status: "active",
            correlationId: "ohs.backend.outage:1",
            data: openData);

        var closeData = JsonSerializer.SerializeToElement(new { kind = "crash", reason = "schedule_end" });
        hub.Ingest(
            id: Guid.NewGuid().ToString("N"),
            ts: DateTimeOffset.UtcNow,
            code: "connection.incident_closed",
            message: "closed",
            severity: "warning",
            status: "resolved",
            correlationId: "ohs.backend.outage:1",
            data: closeData);

        var list = hub.List();
        DataString(list[0], "threadKindHint").Should().Be(NotificationThreadData.KindIncident);
        DataString(list[0], "kind").Should().Be("crash");
        DataString(list[1], "closeOutcome").Should().Be(NotificationThreadData.OutcomeAbandonedSchedule);
    }
}
