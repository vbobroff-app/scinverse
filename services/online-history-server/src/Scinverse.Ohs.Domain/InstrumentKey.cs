namespace Scinverse.Ohs.Domain;

/// <summary>
/// Стабильный ключ инструмента — пара (ticker, board).
/// Ticker — сокращённый код инструмента (TRANSAQ seccode, напр. SBER, RIU6).
/// TRANSAQ secid между сессиями не стабилен, поэтому ключом не служит.
/// </summary>
public readonly record struct InstrumentKey(string Ticker, string Board)
{
    public override string ToString() => $"{Ticker}@{Board}";
}
