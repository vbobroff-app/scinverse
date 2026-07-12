using FluentAssertions;
using Scinverse.Ohs.Connectors.Transaq;

namespace Scinverse.Ohs.UnitTests;

public sealed class TransaqServerStatusParserTests
{
    [Theory]
    [InlineData("<server_status connected=\"true\"/>", ConnectorLinkState.Live)]
    [InlineData("<server_status connected=\"true\" recover=\"true\"/>", ConnectorLinkState.Degraded)]
    [InlineData("<server_status connected=\"false\"/>", ConnectorLinkState.Down)]
    [InlineData("<server_status connected=\"error\"><text>timeout</text></server_status>", ConnectorLinkState.Error)]
    public void TryParse_MapsLinkState(string xml, ConnectorLinkState expected)
    {
        TransaqServerStatusParser.TryParse(xml, out var parsed).Should().BeTrue();
        TransaqServerStatusParser.ToLinkState(parsed).Should().Be(expected);
    }

    [Fact]
    public void TryParse_RejectsNonServerStatus()
    {
        TransaqServerStatusParser.TryParse("<alltrades/>", out _).Should().BeFalse();
    }
}
