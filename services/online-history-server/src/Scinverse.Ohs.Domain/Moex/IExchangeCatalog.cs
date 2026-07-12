namespace Scinverse.Ohs.Domain.Moex;

/// <summary>
/// Каталог структуры биржи (движки → рынки → борды → инструменты). Источник — MOEX ISS,
/// реализация кэширует ответы (структура меняется редко). Отдаёт нормализованные доменные модели,
/// не сырой ISS-формат.
/// </summary>
public interface IExchangeCatalog
{
    /// <summary>Список торговых систем (движков) биржи.</summary>
    Task<IReadOnlyList<IssEngine>> GetEnginesAsync(CancellationToken cancellationToken);

    /// <summary>Рынки указанного движка.</summary>
    Task<IReadOnlyList<IssMarket>> GetMarketsAsync(string engine, CancellationToken cancellationToken);

    /// <summary>Борды (режимы торгов) рынка.</summary>
    Task<IReadOnlyList<IssBoard>> GetBoardsAsync(string engine, string market, CancellationToken cancellationToken);

    /// <summary>Торгуемые инструменты борда (статика).</summary>
    Task<IReadOnlyList<IssSecurity>> GetBoardSecuritiesAsync(
        string engine, string market, string board, CancellationToken cancellationToken);

    /// <summary>Все фьючерсы рынка FORTS (SECID + ASSETCODE) — вход для классификации базового актива.</summary>
    Task<IReadOnlyList<IssFuturesRef>> GetFortsFuturesAsync(CancellationToken cancellationToken);

    /// <summary>
    /// «Группа контрактов» (<c>GROUPTYPE</c>) из описания контракта <c>/iss/securities/{secid}</c> —
    /// авторитетный сигнал MOEX (Акции/Валюта/Индексы/Товары/Ставки). null, если не найдено.
    /// </summary>
    Task<string?> ResolveContractGroupTypeAsync(string secid, CancellationToken cancellationToken);
}
