namespace Scinverse.Ohs.Domain.Schedule;

/// <summary>
/// Порт «подтверждателя расписания» — нейтральная абстракция над внешними источниками (Finam, MOEX ISS…),
/// которые умеют вернуть сессии инструмента/рынка на дату. База (market_schedule) остаётся источником
/// истины; подтверждатель лишь сверяет и предлагает исключения (см. docs/dev/phase7i/schedule.md).
///
/// Адаптеры регистрируются в DI и выбираются по <see cref="Adapter"/> (= external_service.adapter).
/// Специфика источника (символ SECID@MIC у Finam, движок у ISS, наличие/отсутствие секрета) прячется
/// в адаптере; наружу — единый <see cref="ConfirmerSchedule"/>.
/// </summary>
public interface IScheduleConfirmer
{
    /// <summary>Код адаптера (ключ выбора): <c>finam</c> | <c>moex-iss</c>.</summary>
    string Adapter { get; }

    /// <summary>Требуется ли секрет (auth). Публичные источники (ISS) — <c>false</c>.</summary>
    bool RequiresSecret { get; }

    /// <summary>
    /// Что умеет источник: <see cref="ConfirmerCapability.Schedule"/> (окно/фазы дня) и/или
    /// <see cref="ConfirmerCapability.Calendar"/> (праздники/исключения по дате). Calendar-адаптер также
    /// реализует <see cref="ICalendarConfirmer"/>.
    /// </summary>
    IReadOnlyCollection<ConfirmerCapability> Capabilities { get; }

    /// <summary>Health-check источника (для Finam — обмен секрета на JWT; для ISS — доступность).</summary>
    Task<ConfirmerProbe> ProbeAsync(ConfirmerQuery query, CancellationToken cancellationToken);

    /// <summary>Расписание сессий для запроса (символ/движок + дата). Бросает при ошибке источника.</summary>
    Task<ConfirmerSchedule> GetScheduleAsync(ConfirmerQuery query, CancellationToken cancellationToken);
}

/// <summary>
/// Возможности источника-подтверждателя. Один сервис может закрывать несколько (ISS — обе), маппинг
/// «capability → источник» — следующий шаг после булева <c>use_for_schedule</c> (см. schedule.md).
/// </summary>
public enum ConfirmerCapability
{
    /// <summary>Окно/фазы торгового дня (Finam per-instrument; ISS market-wide, сегодня).</summary>
    Schedule,

    /// <summary>Праздники/исключения по дате (ISS <c>dailytable</c>: история + будущее). Finam — нет.</summary>
    Calendar,
}

/// <summary>
/// Capability <see cref="ConfirmerCapability.Calendar"/>: торговый календарь движка на диапазон дат
/// (праздники, переносы, сокращённые дни). Реализуют только источники с историей/горизонтом (ISS).
/// </summary>
public interface ICalendarConfirmer
{
    /// <summary>Календарь движка на [from..to] включительно. Бросает при ошибке источника.</summary>
    Task<ConfirmerCalendar> GetCalendarAsync(
        string engine, DateOnly from, DateOnly to, CancellationToken cancellationToken);
}

/// <summary>Нейтральный торговый календарь: субъект (движок) + дни диапазона.</summary>
public sealed record ConfirmerCalendar(string Subject, IReadOnlyList<ConfirmerCalendarDay> Days);

/// <summary>
/// День календаря: торговый ли, было ли исключение (строка dailytable) и внешние границы дня (МСК,
/// только у торгового дня; грубые — рынок целиком, без per-category).
/// </summary>
public sealed record ConfirmerCalendarDay(
    DateOnly Date, bool IsTradingDay, bool IsException, TimeOnly? Open, TimeOnly? Close);

/// <summary>
/// Запрос к подтверждателю. Каждый адаптер берёт из него то, что понимает:
/// Finam — <see cref="Symbol"/> (SECID@MIC) + <see cref="Secret"/>; ISS — <see cref="Engine"/>
/// (futures/stock/currency). <see cref="Date"/> — целевой день (МСК).
/// </summary>
public sealed record ConfirmerQuery(
    string? Symbol,
    string? Engine,
    DateOnly Date,
    string? Secret);

/// <summary>Результат health-check: успех + человекочитаемое сообщение.</summary>
public sealed record ConfirmerProbe(bool Ok, string Message);

/// <summary>Нейтральное расписание: субъект (символ/движок — для отображения) + список сессий.</summary>
public sealed record ConfirmerSchedule(string Subject, IReadOnlyList<ConfirmerSession> Sessions);

/// <summary>
/// Сессия расписания в нейтральном виде: нормализованный <see cref="Kind"/> (для логики окна),
/// сырой тип источника <see cref="RawType"/> (для UI) и границы окна (UTC-aware).
/// </summary>
public sealed record ConfirmerSession(
    ScheduleSessionKind Kind,
    string RawType,
    DateTimeOffset Start,
    DateTimeOffset End);

/// <summary>
/// Нормализованный класс сессии. В «торговое окно дня» входят только <see cref="Auction"/> и
/// <see cref="Trading"/>; клиринг/расчёт/закрытие — нет (см. <see cref="ScheduleWindow"/>).
/// </summary>
public enum ScheduleSessionKind
{
    /// <summary>Аукцион (открытия/закрытия) — входит в окно.</summary>
    Auction,

    /// <summary>Торговая сессия (утро/основная/вечер/выходной) — входит в окно.</summary>
    Trading,

    /// <summary>Клиринг — вне окна.</summary>
    Clearing,

    /// <summary>Расчётная сессия — вне окна.</summary>
    Settlement,

    /// <summary>Рынок закрыт — вне окна.</summary>
    Closed,

    /// <summary>Неизвестный тип — вне окна.</summary>
    Unknown,
}
