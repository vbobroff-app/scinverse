using System.Threading.Channels;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Connectors.Transaq;

/// <summary>
/// Порт источника рыночных данных. Сырые XML-фрагменты публикуются в <see cref="Messages"/>,
/// что развязывает нативный поток колбэка от конвейера обработки.
/// </summary>
public interface IMarketConnector : IAsyncDisposable
{
    ChannelReader<string> Messages { get; }

    bool IsConnected { get; }

    Task ConnectAsync(CancellationToken cancellationToken);

    Task SubscribeTradesAsync(IReadOnlyCollection<InstrumentKey> instruments, CancellationToken cancellationToken);

    Task DisconnectAsync(CancellationToken cancellationToken);
}
