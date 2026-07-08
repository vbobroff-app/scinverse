namespace Scinverse.Ohs.Domain;

/// <summary>
/// Нормализованная сделка, готовая к записи в md_trade:
/// инструмент разрешён в instrument_id, цена — в ticks.
/// </summary>
public sealed record TradeRecord
{
    public required long InstrumentId { get; init; }
    public required short SourceId { get; init; }
    public required long TradeNo { get; init; }
    public required DateTimeOffset Timestamp { get; init; }
    public required long PriceTicks { get; init; }
    public required int Quantity { get; init; }
    public required MarketSide Side { get; init; }
    public long? OpenInterest { get; init; }
}
