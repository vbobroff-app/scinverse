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
        const string corr = "connection:1:link";

        hub.Open(corr, "connection.lost", "down").Should().BeTrue();
        hub.Open(corr, "connection.lost", "down").Should().BeFalse("повторный open активного — no-op (I2)");

        hub.Progress(corr, "connection.reconnecting", "retry").Should().BeTrue();
        hub.Progress(corr, "connection.reconnecting", "retry").Should().BeFalse("underway→underway — no-op");

        hub.Resolve(corr, "connection.recovered", "up").Should().BeTrue();
        hub.Resolve(corr, "connection.recovered", "up").Should().BeFalse("инцидент уже закрыт — no-op");

        var list = hub.List();
        list.Select(e => e.Status).Should().Equal("active", "underway", "resolved");
        list.Should().OnlyContain(e => e.CorrelationId == corr);
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
    public void Reopen_afterResolve_startsNewActiveIncident()
    {
        var hub = NewHub();
        const string corr = "c";

        hub.Open(corr, "connection.lost", "down").Should().BeTrue();
        hub.Resolve(corr, "connection.recovered", "up").Should().BeTrue();
        hub.Open(corr, "connection.lost", "down again").Should().BeTrue("после resolved инцидент можно открыть заново");

        hub.List().Select(e => e.Status).Should().Equal("active", "resolved", "active");
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
