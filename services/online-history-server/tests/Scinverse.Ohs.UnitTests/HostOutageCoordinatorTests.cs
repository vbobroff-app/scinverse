using FluentAssertions;
using Scinverse.Ohs.Host;

namespace Scinverse.Ohs.UnitTests;

public sealed class HostOutageCoordinatorTests
{
    private static readonly DateTimeOffset T0 = new(2026, 7, 30, 1, 42, 47, TimeSpan.Zero);

    [Fact]
    public void Two_clients_same_window_one_seed_min_from()
    {
        var c = new HostOutageCoordinator();
        var later = T0.AddSeconds(30);
        var earlier = T0;

        var a = c.Report("client-a", later, to: null);
        a.IsNewEpisode.Should().BeTrue();
        a.OpenedEmitted.Should().BeTrue();
        a.OutageSeed.Should().Be(later.ToUnixTimeMilliseconds());

        var b = c.Report("client-b", earlier, to: null);
        b.Merged.Should().BeTrue();
        b.IsNewEpisode.Should().BeFalse();
        b.OpenedEmitted.Should().BeFalse();
        b.OutageSeed.Should().Be(earlier.ToUnixTimeMilliseconds());
        b.OpenedAt.Should().Be(earlier);

        c.Current!.ClientIds.Should().BeEquivalentTo("client-a", "client-b");
        c.Current.TransportCorrUid.Should().Be($"ohs.host.transport:{earlier.ToUnixTimeMilliseconds()}");
    }

    [Fact]
    public void First_close_emits_once_second_close_noop()
    {
        var c = new HostOutageCoordinator();
        var from = T0;
        var to = T0.AddMinutes(3);

        c.Report("a", from, to: null).ClosedEmitted.Should().BeFalse();

        var close1 = c.Report("a", from, to);
        close1.Merged.Should().BeTrue();
        close1.ClosedEmitted.Should().BeTrue();
        close1.ClosedAt.Should().Be(to);

        var close2 = c.Report("b", from.AddSeconds(10), to.AddSeconds(5));
        close2.Merged.Should().BeTrue();
        close2.ClosedEmitted.Should().BeFalse();
        close2.ClosedAt.Should().Be(to);
        c.Current!.ClientIds.Should().BeEquivalentTo("a", "b");
    }

    [Fact]
    public void Outside_merge_window_starts_new_episode()
    {
        var c = new HostOutageCoordinator(TimeSpan.FromSeconds(120));
        var first = c.Report("a", T0, T0.AddMinutes(1));
        first.IsNewEpisode.Should().BeTrue();

        var far = T0.AddMinutes(10);
        var second = c.Report("b", far, to: null);
        second.IsNewEpisode.Should().BeTrue();
        second.Merged.Should().BeFalse();
        second.OutageSeed.Should().Be(far.ToUnixTimeMilliseconds());
        second.OutageSeed.Should().NotBe(first.OutageSeed);
    }

    [Fact]
    public void Open_and_close_in_one_post()
    {
        var c = new HostOutageCoordinator();
        var r = c.Report("solo", T0, T0.AddSeconds(90));
        r.IsNewEpisode.Should().BeTrue();
        r.OpenedEmitted.Should().BeTrue();
        r.ClosedEmitted.Should().BeTrue();
        r.ClosedAt.Should().Be(T0.AddSeconds(90));
    }

    [Fact]
    public void Layer_c_corr_is_transport_seed_without_connection_suffix()
    {
        var c = new HostOutageCoordinator();
        c.Report("a", T0, to: null);
        c.Current!.LayerCCorrUid.Should().Be($"ohs.backend.outage:{T0.ToUnixTimeMilliseconds()}");
        c.Current.Code.Should().Be(HostOutageCoordinator.DefaultOutageCode);
    }

    [Fact]
    public void Different_code_in_window_starts_new_episode()
    {
        var c = new HostOutageCoordinator();
        var first = c.Report("a", T0, to: null, code: HostOutageCoordinator.DefaultOutageCode);
        first.IsNewEpisode.Should().BeTrue();

        var other = c.Report("b", T0.AddSeconds(10), to: null, code: "other.signal");
        other.IsNewEpisode.Should().BeTrue();
        other.Merged.Should().BeFalse();
        other.OutageSeed.Should().NotBe(first.OutageSeed);
        other.Code.Should().Be("other.signal");
        c.Current!.Code.Should().Be("other.signal");
    }

    [Fact]
    public void Same_code_in_window_merges()
    {
        var c = new HostOutageCoordinator();
        c.Report("a", T0, to: null, code: "host.unreachable");
        var b = c.Report("b", T0.AddSeconds(15), to: null, code: "host.unreachable");
        b.Merged.Should().BeTrue();
        b.IsNewEpisode.Should().BeFalse();
        c.Current!.ClientIds.Should().BeEquivalentTo("a", "b");
    }
}
