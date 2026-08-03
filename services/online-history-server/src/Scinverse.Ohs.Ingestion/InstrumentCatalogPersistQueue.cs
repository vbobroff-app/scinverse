using System.Threading.Channels;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Ingestion;

/// <summary>
/// Очередь фоновой записи справочника (startup-latency #3): pump кладёт SecurityInfo без ожидания БД,
/// <c>InstrumentCatalogPersistWriter</c> дренит батчами. При переполнении DropOldest — справочник
/// не должен давить hot path сделок; следующий invalidate/connect догонит.
/// </summary>
public sealed class InstrumentCatalogPersistQueue
{
    private readonly Channel<SecurityInfo> _channel = Channel.CreateBounded<SecurityInfo>(
        new BoundedChannelOptions(100_000)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = false,
        });

    public void Enqueue(SecurityInfo security) => _channel.Writer.TryWrite(security);

    public ChannelReader<SecurityInfo> Reader => _channel.Reader;

    public int ApproxCount => _channel.Reader.Count;
}
