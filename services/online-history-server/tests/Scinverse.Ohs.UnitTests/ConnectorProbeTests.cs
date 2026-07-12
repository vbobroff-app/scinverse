using FluentAssertions;
using Scinverse.Ohs.Connectors.Transaq;

namespace Scinverse.Ohs.UnitTests;

public sealed class ConnectorProbeTests
{
    [Fact]
    public async Task SyntheticLive_ProbeConnection_ReturnsTrueWhenConnected()
    {
        var connector = new SyntheticLiveConnector(interval: TimeSpan.FromHours(1));
        await connector.ConnectAsync(CancellationToken.None);

        var ok = await connector.ProbeConnectionAsync(CancellationToken.None);

        ok.Should().BeTrue();
        await connector.DisposeAsync();
    }

    [Fact]
    public async Task SyntheticLive_ProbeConnection_ReturnsFalseWhenDisconnected()
    {
        var connector = new SyntheticLiveConnector(interval: TimeSpan.FromHours(1));
        await connector.ConnectAsync(CancellationToken.None);
        await connector.DisconnectAsync(CancellationToken.None);

        var ok = await connector.ProbeConnectionAsync(CancellationToken.None);

        ok.Should().BeFalse();
        await connector.DisposeAsync();
    }
}
