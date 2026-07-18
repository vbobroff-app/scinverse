using FluentAssertions;
using Scinverse.Ohs.Host;

namespace Scinverse.Ohs.UnitTests;

/// <summary>Оркестратор жизненного цикла (ось B, 11.2): переходы + идемпотентность под lock.</summary>
public sealed class NotificationHubTests
{
    private static NotificationHub NewHub() => new(new WebSocketBroadcaster());

    [Fact]
    public void Open_progress_resolve_transitions_and_isIdempotent()
    {
        var hub = NewHub();
        const string subject = "connection:1:link";

        hub.Open(subject, "connection.lost", "down").Should().BeTrue();
        hub.Open(subject, "connection.lost", "down").Should().BeFalse("повторный open активного — no-op (I2)");

        hub.Progress(subject, "connection.reconnecting", "retry").Should().BeTrue();
        hub.Progress(subject, "connection.reconnecting", "retry").Should().BeFalse("underway→underway — no-op");

        hub.Resolve(subject, "connection.recovered", "up").Should().BeTrue();
        hub.Resolve(subject, "connection.recovered", "up").Should().BeFalse("инцидент уже закрыт — no-op");

        var list = hub.List();
        list.Select(e => e.Status).Should().Equal("active", "underway", "resolved");

        // Все три события одного инцидента делят один per-occurrence correlationId = subject:uid.
        var ids = list.Select(e => e.CorrelationId).Distinct().ToList();
        ids.Should().ContainSingle();
        ids[0].Should().StartWith(subject + ":");
        ids[0]!.Length.Should().BeGreaterThan(subject.Length + 1, "после subject: должен идти uid");
    }

    [Fact]
    public void Progress_withoutOpenIncident_isNoop()
    {
        var hub = NewHub();
        hub.Progress("c", "connection.reconnecting", "retry").Should().BeFalse();
        hub.List().Should().BeEmpty();
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
}
