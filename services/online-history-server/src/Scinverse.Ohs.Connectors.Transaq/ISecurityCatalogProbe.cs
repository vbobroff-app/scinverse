using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Connectors.Transaq;

/// <summary>
/// Диагностика: запрос справки по одному инструменту у шлюза (TRANSAQ <c>get_securities_info</c>).
/// </summary>
public interface ISecurityCatalogProbe
{
    /// <summary>
    /// Шлёт <c>get_securities_info</c> (market + seccode) и ждёт async-колбэк с этим seccode.
    /// </summary>
    Task<SecurityProbeResult> ProbeSecurityAsync(
        int marketId, string seccode, TimeSpan timeout, CancellationToken cancellationToken);
}

/// <param name="CommandAccepted">Синхронный ответ SendCommand success≠false.</param>
/// <param name="FoundInCallback">В колбэке за timeout пришёл XML с этим seccode.</param>
/// <param name="CommandResultXml">Сырой синхронный result от DLL (может быть null).</param>
/// <param name="CallbackXml">Сырой async-фрагмент с инструментом (если найден).</param>
/// <param name="Message">Краткий итог для UI/логов.</param>
public sealed record SecurityProbeResult(
    bool CommandAccepted,
    bool FoundInCallback,
    string? CommandResultXml,
    string? CallbackXml,
    string Message);
