namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>Строка выборки инструмента (Dapper-маппинг по алиасам).</summary>
internal sealed class InstrumentRow
{
    public long InstrumentId { get; init; }
    public string Ticker { get; init; } = string.Empty;
    public string BoardId { get; init; } = string.Empty;
    public decimal MinStep { get; init; }
    public short? Decimals { get; init; }
    public int? LotSize { get; init; }
}

/// <summary>Строка каталога инструментов (read-model для админки).</summary>
internal sealed class InstrumentCatalogRow
{
    public long InstrumentId { get; init; }
    public string Ticker { get; init; } = string.Empty;
    public string Board { get; init; } = string.Empty;
    public string? SecType { get; init; }
    public string? Name { get; init; }
    public decimal MinStep { get; init; }
    public short? Decimals { get; init; }
    public bool Active { get; init; }
    public bool Recording { get; init; }
    public decimal? Strike { get; init; }
    public string? OptionType { get; init; }
    public DateOnly? Expiration { get; init; }
    public int Total { get; init; }
}

/// <summary>Строка узла дерева каталога (группировка).</summary>
internal sealed class InstrumentGroupRow
{
    public string Key { get; init; } = string.Empty;
    public string Label { get; init; } = string.Empty;
    public int Count { get; init; }
    public DateOnly? Expiration { get; init; }
}
