using System.Text.Json;
using FluentAssertions;
using Scinverse.Ohs.Host;

namespace Scinverse.Ohs.UnitTests;

public sealed class HostOutageTransportEmitterTests
{
    private static readonly DateTimeOffset T0 = new(2026, 7, 30, 2, 19, 22, TimeSpan.Zero);

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
    public void Open_and_close_emit_transport_group_without_connectionId()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var emitter = new HostOutageTransportEmitter(hub);
        var coord = new HostOutageCoordinator();

        var open = coord.Report("a", T0, to: null);
        emitter.Apply(open);

        var close = coord.Report("a", T0, T0.AddMinutes(3));
        emitter.Apply(close);

        var list = hub.List();
        list.Should().HaveCount(2);
        list[0].Code.Should().Be(HostOutageCoordinator.DefaultOutageCode);
        list[0].Status.Should().Be("active");
        list[0].Severity.Should().Be("error");
        list[0].Module.Should().Be(HostOutageTransportEmitter.Module);
        list[0].CorrelationId.Should().Be($"ohs.host.transport:{T0.ToUnixTimeMilliseconds()}");
        list[0].Ts.Should().Be(T0);
        list[0].Message.Should().Be(HostOutageTransportEmitter.OpenMessage);
        DataString(list[0], "threadKindHint").Should().Be(NotificationThreadData.KindGroup);
        DataString(list[0], "sender").Should().Be("client");
        list[0].Data!.Value.TryGetProperty("connectionId", out _).Should().BeFalse();

        list[1].Code.Should().Be(HostOutageTransportEmitter.CodeReachable);
        list[1].Status.Should().Be("resolved");
        list[1].Severity.Should().Be("ok");
        list[1].CorrelationId.Should().Be(list[0].CorrelationId);
        list[1].Ts.Should().Be(T0.AddMinutes(3));
        DataString(list[1], "closeOutcome").Should().Be(NotificationThreadData.OutcomeRecovered);
        list[1].Data!.Value.TryGetProperty("connectionId", out _).Should().BeFalse();
    }

    [Fact]
    public void Merge_second_client_does_not_duplicate_open()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var emitter = new HostOutageTransportEmitter(hub);
        var coord = new HostOutageCoordinator();

        emitter.Apply(coord.Report("a", T0, to: null));
        emitter.Apply(coord.Report("b", T0.AddSeconds(20), to: null));
        emitter.Apply(coord.Report("b", T0.AddSeconds(20), T0.AddMinutes(1)));

        var list = hub.List();
        list.Should().HaveCount(2);
        list.Count(e => e.Code == HostOutageCoordinator.DefaultOutageCode).Should().Be(1);
        list.Count(e => e.Code == HostOutageTransportEmitter.CodeReachable).Should().Be(1);
    }

    [Fact]
    public void Second_close_is_noop_for_nc()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var emitter = new HostOutageTransportEmitter(hub);
        var coord = new HostOutageCoordinator();

        emitter.Apply(coord.Report("a", T0, T0.AddSeconds(30)));
        emitter.Apply(coord.Report("b", T0.AddSeconds(5), T0.AddSeconds(40)));

        hub.List().Should().HaveCount(2);
    }
}
