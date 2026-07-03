using System.Threading.Channels;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Connectors.Transaq;

/// <summary>
/// Тестовый/демо-коннектор: воспроизводит заранее заданные XML-фрагменты
/// (securities/alltrades) без нативной DLL. Полезен для e2e-прогона конвейера.
/// </summary>
public sealed class FakeReplayConnector : IMarketConnector
{
    private readonly IReadOnlyList<string> _fragments;
    private readonly Channel<string> _messages;

    public FakeReplayConnector(IEnumerable<string> fragments)
    {
        _fragments = fragments.ToList();
        _messages = Channel.CreateUnbounded<string>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = true
        });
    }

    public ChannelReader<string> Messages => _messages.Reader;

    public bool IsConnected { get; private set; }

    public Task ConnectAsync(CancellationToken cancellationToken)
    {
        IsConnected = true;
        return Task.CompletedTask;
    }

    public Task SubscribeTradesAsync(IReadOnlyCollection<InstrumentKey> instruments, CancellationToken cancellationToken)
    {
        foreach (var fragment in _fragments)
        {
            _messages.Writer.TryWrite(fragment);
        }

        _messages.Writer.TryComplete();
        return Task.CompletedTask;
    }

    public Task DisconnectAsync(CancellationToken cancellationToken)
    {
        IsConnected = false;
        _messages.Writer.TryComplete();
        return Task.CompletedTask;
    }

    public ValueTask DisposeAsync()
    {
        _messages.Writer.TryComplete();
        return ValueTask.CompletedTask;
    }
}
