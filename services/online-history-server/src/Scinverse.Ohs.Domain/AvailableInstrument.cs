namespace Scinverse.Ohs.Domain;

/// <summary>Строка Available (Online <c>active</c>) для eval/preview наборов.</summary>
public sealed record AvailableInstrument(
    long InstrumentId,
    string Ticker,
    string Board,
    string? SecType);
