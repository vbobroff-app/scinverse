namespace Scinverse.Ohs.Domain;

/// <summary>Зарегистрированный инструмент: стабильный id + параметры для конвертации цены.</summary>
public sealed record Instrument
{
    public required long InstrumentId { get; init; }
    public required InstrumentKey Key { get; init; }
    public required decimal MinStep { get; init; }
    public short Decimals { get; init; }
    public int? LotSize { get; init; }

    /// <summary>Цена → ticks по шагу этого инструмента.</summary>
    public long ToTicks(decimal price) => TickMath.ToTicks(price, MinStep);

    /// <summary>ticks → цена по шагу этого инструмента.</summary>
    public decimal ToPrice(long ticks) => TickMath.ToPrice(ticks, MinStep);
}
