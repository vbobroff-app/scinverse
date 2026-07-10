namespace Scinverse.Ohs.Domain;

/// <summary>Справочная информация об инструменте (секция TRANSAQ securities).</summary>
public sealed record SecurityInfo : IMarketMessage
{
    public required InstrumentKey Key { get; init; }
    public int? TransaqSecId { get; init; }
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

    // --- Атрибуты дериватива (FUT/OPT); null для не-деривативов. См. IDerivativeSpecParser. ---

    /// <summary>Код базового актива для группировки (напр. Si, RI, BR).</summary>
    public string? UnderlyingCode { get; init; }

    /// <summary>Код базового фьючерса опциона (для резолва underlying_id).</summary>
    public string? UnderlyingFuturesCode { get; init; }

    public DateOnly? Expiration { get; init; }

    /// <summary>'C'/'P'; null для фьючерса.</summary>
    public char? OptionType { get; init; }

    public decimal? Strike { get; init; }
}
