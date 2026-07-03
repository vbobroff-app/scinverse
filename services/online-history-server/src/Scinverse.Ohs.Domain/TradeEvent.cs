namespace Scinverse.Ohs.Domain;

/// <summary>
/// Сделка из ленты (секция TRANSAQ alltrades) до нормализации.
/// Цена — в исходных денежных единицах; в ticks переводится нормализатором.
/// </summary>
public sealed record TradeEvent : IMarketMessage
{
    public required InstrumentKey Key { get; init; }
    public required long TradeNo { get; init; }
    public required DateTimeOffset Timestamp { get; init; }
    public required decimal Price { get; init; }
    public required int Quantity { get; init; }
    public required MarketSide Side { get; init; }
    public long? OpenInterest { get; init; }
}
