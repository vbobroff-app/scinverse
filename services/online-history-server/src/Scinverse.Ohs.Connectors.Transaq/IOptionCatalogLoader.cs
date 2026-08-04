using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Connectors.Transaq;

/// <summary>
/// Явная загрузка опционов TRANSAQ: families → strikes → get_options (Finam support 2026-07-16).
/// </summary>
public interface IOptionCatalogLoader
{
    /// <summary>Subscribe FUT + ждать цену сделки в колбэке alltrades (короткий timeout).</summary>
    Task<decimal?> WaitFuturesTradePriceAsync(
        InstrumentKey futures, TimeSpan timeout, CancellationToken cancellationToken);

    Task<IReadOnlyList<OptionFamily>> GetOptionFamiliesAsync(
        InstrumentKey underlying, TimeSpan timeout, CancellationToken cancellationToken);

    Task<IReadOnlyList<OptionStrikeQuote>> GetFamilyStrikesAsync(
        InstrumentKey underlying, DateOnly matDate, TimeSpan timeout, CancellationToken cancellationToken);

    /// <summary>
    /// <c>get_options</c> по списку opt_code; ждёт <c>securities</c> или <c>options_failed</c>.
    /// </summary>
    Task<OptionLoadCommandResult> GetOptionsAsync(
        IReadOnlyList<string> optCodes, TimeSpan timeout, CancellationToken cancellationToken);
}

/// <param name="Accepted">Синхронный success SendCommand.</param>
/// <param name="SecuritiesCallback">Пришёл callback securities.</param>
/// <param name="Failed">Пришёл options_failed.</param>
/// <param name="CallbackXml">Сырой XML колбэка.</param>
/// <param name="Message">Краткий итог.</param>
public sealed record OptionLoadCommandResult(
    bool Accepted,
    bool SecuritiesCallback,
    bool Failed,
    string? CallbackXml,
    string Message);
