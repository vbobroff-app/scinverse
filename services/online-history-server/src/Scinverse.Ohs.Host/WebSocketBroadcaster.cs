using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Fan-out live-событий по всем подключённым WebSocket-клиентам. На каждого клиента —
/// свой ограниченный канал с отбрасыванием старых сообщений (медленный клиент не блокирует остальных).
/// </summary>
public sealed class WebSocketBroadcaster
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly ConcurrentDictionary<Guid, Channel<string>> _clients = new();

    /// <summary>Сериализует и рассылает событие всем клиентам (best-effort).</summary>
    public void Broadcast(LiveEvent liveEvent)
    {
        if (_clients.IsEmpty)
        {
            return;
        }

        var json = JsonSerializer.Serialize(liveEvent, liveEvent.GetType(), JsonOptions);
        foreach (var channel in _clients.Values)
        {
            channel.Writer.TryWrite(json);
        }
    }

    /// <summary>Обслуживает один сокет до его закрытия/отмены.</summary>
    public async Task HandleAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        var id = Guid.NewGuid();
        var channel = Channel.CreateBounded<string>(new BoundedChannelOptions(256)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = false
        });
        _clients[id] = channel;

        try
        {
            var sendTask = SendLoopAsync(socket, channel.Reader, cancellationToken);
            await ReceiveUntilCloseAsync(socket, cancellationToken).ConfigureAwait(false);
            channel.Writer.TryComplete();
            await sendTask.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Штатная остановка.
        }
        catch (WebSocketException)
        {
            // Клиент отвалился — молча убираем.
        }
        finally
        {
            _clients.TryRemove(id, out _);
        }
    }

    private static async Task SendLoopAsync(WebSocket socket, ChannelReader<string> reader, CancellationToken cancellationToken)
    {
        await foreach (var json in reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            if (socket.State != WebSocketState.Open)
            {
                break;
            }

            var bytes = Encoding.UTF8.GetBytes(json);
            await socket.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, cancellationToken)
                .ConfigureAwait(false);
        }
    }

    private static async Task ReceiveUntilCloseAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[1024];
        while (socket.State == WebSocketState.Open)
        {
            var result = await socket.ReceiveAsync(buffer, cancellationToken).ConfigureAwait(false);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, null, cancellationToken).ConfigureAwait(false);
                break;
            }
        }
    }
}
