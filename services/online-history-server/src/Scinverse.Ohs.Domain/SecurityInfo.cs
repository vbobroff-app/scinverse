namespace Scinverse.Ohs.Domain;

/// <summary>Справочная информация об инструменте (секция TRANSAQ securities).</summary>
public sealed record SecurityInfo : IMarketMessage
{
    public required InstrumentKey Key { get; init; }
    public int? TransaqSecid { get; init; }
    public int? MarketId { get; init; }
    public string? ShortName { get; init; }
    public string? Name { get; init; }
    public string? SecType { get; init; }
    public short Decimals { get; init; }

    /// <summary>Шаг цены; основа конвертации price ↔ ticks.</summary>
    public required decimal MinStep { get; init; }

    public int? LotSize { get; init; }
    public decimal? PointCost { get; init; }
    public string? Currency { get; init; }
}
