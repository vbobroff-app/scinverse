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

    /// <summary>
    /// Бесплатный машиночитаемый календарь движка (<c>/iss/engines/{engine}</c>: <c>timetable</c> +
    /// <c>dailytable</c>) — торговые/неторговые дни и внешние часы дня (праздники, переносы,
    /// сокращённые дни, вкл. будущие). Реализация кэширует ответ.
    /// </summary>
    Task<EngineCalendar> GetEngineCalendarAsync(string engine, CancellationToken cancellationToken);

    /// <summary>
    /// Тонкое расписание сессий движка на ТЕКУЩИЙ день (<c>/iss/engines/{engine}</c>,
    /// таблица <c>session_schedule</c>) — бесплатно, без auth, market-wide. Параметр даты ISS игнорирует.
    /// Реализация кэширует ответ ненадолго. См. docs/dev/phase7c/apply.md §3.
    /// </summary>
    Task<IReadOnlyList<IssSessionSlot>> GetSessionScheduleAsync(string engine, CancellationToken cancellationToken);
}
