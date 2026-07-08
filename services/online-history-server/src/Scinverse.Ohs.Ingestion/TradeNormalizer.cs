using System.Diagnostics.CodeAnalysis;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Ingestion;

/// <summary>
/// Преобразует <see cref="TradeEvent"/> (сырая цена) в <see cref="TradeRecord"/>
/// (instrument_id + price_ticks). Сделки по неизвестным инструментам отбрасываются.
/// </summary>
public sealed class TradeNormalizer(IInstrumentRegistry registry)
{
    public bool TryNormalize(TradeEvent trade, short sourceId, [MaybeNullWhen(false)] out TradeRecord record)
    {
        if (!registry.TryResolve(trade.Key, out var instrument))
        {
            record = null;
            return false;
        }

        record = new TradeRecord
        {
            InstrumentId = instrument.InstrumentId,
            SourceId = sourceId,
            TradeNo = trade.TradeNo,
            Timestamp = trade.Timestamp,
            PriceTicks = instrument.ToTicks(trade.Price),
            Quantity = trade.Quantity,
            Side = trade.Side,
            OpenInterest = trade.OpenInterest
        };
        return true;
    }
}
