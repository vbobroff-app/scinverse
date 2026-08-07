namespace Scinverse.Ohs.Domain;

/// <summary>
/// Строка Available (Online <c>active</c>) для eval/preview наборов.
/// Glob static матчит <see cref="ShortName"/> (обозначение MOEX), не <see cref="Ticker"/>.
/// </summary>
public sealed record AvailableInstrument(
    long InstrumentId,
    string Ticker,
    string Board,
    string? SecType,
    string? ShortName = null,
    DateOnly? Expiration = null);
