using System.Diagnostics.CodeAnalysis;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Ingestion;

/// <summary>
/// Преобразует <see cref="TradeEvent"/> (сырая цена) в <see cref="TradeRecord"/>
/// (instrument_id + price_ticks). Сделки по неизвестным инструментам отбрасываются.
/// </summary>
public sealed class TradeNormalizer
{
    private readonly IInstrumentRegistry _registry;

    public TradeNormalizer(IInstrumentRegistry registry) => _registry = registry;

    public bool TryNormalize(TradeEvent trade, [MaybeNullWhen(false)] out TradeRecord record)
    {
        if (!_registry.TryResolve(trade.Key, out var instrument))
        {
            record = null;
            return false;
        }

        record = new TradeRecord
        {
            InstrumentId = instrument.InstrumentId,
            TradeNo = trade.TradeNo,
            Timestamp = trade.Timestamp,
            PriceTicks = TickMath.ToTicks(trade.Price, instrument.MinStep),
            Quantity = trade.Quantity,
            Side = trade.Side,
            OpenInterest = trade.OpenInterest
        };
        return true;
    }
}
