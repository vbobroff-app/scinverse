using FluentAssertions;
using Scinverse.Ohs.Connectors.Transaq;

namespace Scinverse.Ohs.UnitTests;

public sealed class SyntheticLinkStateTests
{
    [Fact]
    public async Task InjectLinkState_PublishesDownThenLive()
    {
        var connector = new SyntheticLiveConnector(interval: TimeSpan.FromHours(1));
        await connector.ConnectAsync(CancellationToken.None);

        var changes = new List<ConnectorLinkStateChange>();
        var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var readTask = Task.Run(async () =>
        {
            await foreach (var change in connector.LinkStateChanges.ReadAllAsync(cts.Token))
            {
                changes.Add(change);
            }
        }, cts.Token);

        connector.InjectLinkState(ConnectorLinkState.Down);
        connector.InjectLinkState(ConnectorLinkState.Live);

        await Task.Delay(100);
        cts.Cancel();
        try { await readTask; } catch (OperationCanceledException) { }

        changes.Select(c => c.State).Should().ContainInOrder(
            ConnectorLinkState.Live, ConnectorLinkState.Down, ConnectorLinkState.Live);

        await connector.DisposeAsync();
    }
}
