using System.Threading.Channels;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Ingestion;

/// <summary>
/// Буфер сделок с backpressure. Продюсер кладёт записи в ограниченный канал,
/// фоновой цикл собирает батчи (по размеру или по таймауту) и отдаёт их <see cref="ITradeWriter"/>.
/// </summary>
public sealed class TradeBatcher(ITradeWriter writer, TradeBatcherOptions options)
{
    private readonly Channel<TradeRecord> _channel = Channel.CreateBounded<TradeRecord>(
        new BoundedChannelOptions(options.Capacity)
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.Wait
        });

    public ValueTask EnqueueAsync(TradeRecord record, CancellationToken cancellationToken) =>
        _channel.Writer.WriteAsync(record, cancellationToken);

    public void Complete() => _channel.Writer.TryComplete();

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        var reader = _channel.Reader;
        var buffer = new List<TradeRecord>(options.BatchSize);

        while (true)
        {
            try
            {
                buffer.Add(await reader.ReadAsync(cancellationToken).ConfigureAwait(false));
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (ChannelClosedException)
            {
                break;
            }

            using var flushTimeout = new CancellationTokenSource(options.FlushInterval);
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, flushTimeout.Token);

            try
            {
                while (buffer.Count < options.BatchSize)
                {
                    buffer.Add(await reader.ReadAsync(linked.Token).ConfigureAwait(false));
                }
            }
            catch (OperationCanceledException)
            {
                // Истёк flush-таймаут или запрошено завершение — сбрасываем накопленное.
            }
            catch (ChannelClosedException)
            {
                await FlushAsync(buffer).ConfigureAwait(false);
                break;
            }

            await FlushAsync(buffer).ConfigureAwait(false);
        }

        // Досбор остатка после отмены/закрытия канала.
        while (reader.TryRead(out var record))
        {
            buffer.Add(record);
            if (buffer.Count >= options.BatchSize)
            {
                await FlushAsync(buffer).ConfigureAwait(false);
            }
        }

        await FlushAsync(buffer).ConfigureAwait(false);
    }

    private async Task FlushAsync(List<TradeRecord> buffer)
    {
        if (buffer.Count == 0)
        {
            return;
        }

        await writer.WriteAsync(buffer, CancellationToken.None).ConfigureAwait(false);
        buffer.Clear();
    }
}
