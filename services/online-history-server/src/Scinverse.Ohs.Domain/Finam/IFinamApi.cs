namespace Scinverse.Ohs.Domain.Finam;

/// <summary>
/// Порт Finam Trade API (request/response + JWT). Аутентификация: секрет <c>tapi_sk_…</c> обменивается
/// на короткоживущий JWT (<c>tapi_ak</c>, TTL ~15 мин), которым ходим в API. MVP-поверхность —
/// только расписание инструмента (подтверждатель для market_schedule, см. phase7i/schedule.md).
/// </summary>
public interface IFinamApi
{
    /// <summary>Обменивает секрет на JWT (health-check интеграции). Бросает при ошибке auth/сети.</summary>
    Task<string> AuthenticateAsync(string secret, CancellationToken cancellationToken);

    /// <summary>Расписание сессий инструмента (напр. <c>SBER@MISX</c>). JWT резолвится из секрета (кэш).</summary>
    Task<FinamSchedule> GetScheduleAsync(string secret, string symbol, CancellationToken cancellationToken);
}

/// <summary>Расписание инструмента Finam: символ + список сессий (окна в UTC).</summary>
public sealed record FinamSchedule(string Symbol, IReadOnlyList<FinamSession> Sessions);

/// <summary>
/// Сессия расписания Finam: тип (<c>CORE_TRADING</c>|<c>EARLY_TRADING</c>|<c>LATE_TRADING</c>|
/// <c>OPENING_AUCTION</c>|<c>CLOSING_AUCTION</c>|<c>CLEARING</c>|<c>CLOSED</c>) и границы окна (UTC).
/// </summary>
public sealed record FinamSession(string Type, DateTimeOffset Start, DateTimeOffset End);
