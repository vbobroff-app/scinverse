namespace Scinverse.Ohs.Domain;

/// <summary>Зарегистрированный инструмент: стабильный id + параметры для конвертации цены.</summary>
public sealed record Instrument
{
    public required long InstrumentId { get; init; }
    public required InstrumentKey Key { get; init; }
    public required decimal MinStep { get; init; }
    public short Decimals { get; init; }
    public int? LotSize { get; init; }
}
