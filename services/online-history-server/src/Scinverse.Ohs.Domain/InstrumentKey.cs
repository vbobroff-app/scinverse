namespace Scinverse.Ohs.Domain;

/// <summary>
/// Стабильный ключ инструмента — пара (seccode, board).
/// TRANSAQ secid между сессиями не стабилен, поэтому ключом не служит.
/// </summary>
public readonly record struct InstrumentKey(string Seccode, string Board)
{
    public override string ToString() => $"{Seccode}@{Board}";
}
