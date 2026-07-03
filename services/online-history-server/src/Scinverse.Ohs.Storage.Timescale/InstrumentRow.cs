namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>Строка выборки инструмента (Dapper-маппинг по алиасам).</summary>
internal sealed class InstrumentRow
{
    public long InstrumentId { get; init; }
    public string Seccode { get; init; } = string.Empty;
    public string BoardId { get; init; } = string.Empty;
    public decimal MinStep { get; init; }
    public short? Decimals { get; init; }
    public int? LotSize { get; init; }
}
