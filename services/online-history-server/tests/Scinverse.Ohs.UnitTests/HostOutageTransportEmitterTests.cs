using FluentAssertions;
using Scinverse.Ohs.Host;

namespace Scinverse.Ohs.UnitTests;

public sealed class HostOutageTransportEmitterTests
{
    private static readonly DateTimeOffset T0 = new(2026, 7, 30, 2, 19, 22, TimeSpan.Zero);

    [Fact]
    public void Apply_does_not_emit_transport_group_into_hub()
    {
        var hub = new NotificationHub(new WebSocketBroadcaster());
        var emitter = new HostOutageTransportEmitter();
        var coord = new HostOutageCoordinator();

        emitter.Apply(coord.Report("a", T0, to: null));
        emitter.Apply(coord.Report("a", T0, T0.AddMinutes(3)));
        emitter.Apply(coord.Report("b", T0.AddSeconds(20), to: null));

        hub.List().Should().BeEmpty("слой T в NC отключён — только coordinator + слой C");
    }
}
