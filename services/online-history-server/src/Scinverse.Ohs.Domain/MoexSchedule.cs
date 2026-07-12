namespace Scinverse.Ohs.Domain;

/// <summary>Торговая сессия MOEX: границы по календарной дате (МСК = UTC+3, без перехода на летнее время).</summary>
public sealed record TradingSession
{
    /// <summary>Календарная дата сессии (в МСК).</summary>
    public required DateOnly Date { get; init; }

    /// <summary>Начало сессии (со смещением +03:00).</summary>
    public required DateTimeOffset Start { get; init; }

    /// <summary>Конец сессии (со смещением +03:00).</summary>
    public required DateTimeOffset End { get; init; }

    /// <summary>Признак выходного дня (ДСВД, суббота/воскресенье).</summary>
    public required bool Weekend { get; init; }
}

/// <summary>
/// Часы торгового дня MOEX (ЕТС/ФОРТС, с 23.03.2026).
/// <list type="bullet">
/// <item>Будний день: <c>08:50–23:50</c> МСК (утренняя доп. + основная + вечерняя).</item>
/// <item>Выходной день (доп. сессия выходного дня, с 01.03.2025): <c>09:50–19:00</c> МСК.</item>
/// </list>
/// Праздничный календарь не моделируется — фактические торговые дни берутся из наличия данных
/// (<see cref="ICoverageStore"/>), а этот класс лишь раздаёт часы для конкретной даты.
/// <para>
/// ВНИМАНИЕ: с 14.07.2026 на срочном рынке (СР/FORTS) торговый день — <c>06:50–23:50</c>
/// (аукцион 06:50–07:00, утренняя 07:00–10:00, основная 10:00–19:00, вечерняя 19:00–23:50;
/// источник moex.com/n101980). Хардкод часов дат-независим и станет неверным — расписание
/// нужно брать из ISS (phase 7c) или обновить константы с датой вступления. См.
/// docs/dev/phase7c/apply.md §3c.
/// </para>
/// </summary>
public static class MoexSchedule
{
    /// <summary>Смещение московского времени (без DST).</summary>
    public static readonly TimeSpan MoscowOffset = TimeSpan.FromHours(3);

    private static readonly TimeOnly WeekdayStart = new(8, 50);
    private static readonly TimeOnly WeekdayEnd = new(23, 50);
    private static readonly TimeOnly WeekendStart = new(9, 50);
    private static readonly TimeOnly WeekendEnd = new(19, 0);

    /// <summary>Возвращает границы сессии для указанной календарной даты (МСК), эвристические часы.</summary>
    public static TradingSession Session(DateOnly date)
    {
        var weekend = date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;
        var (start, end) = weekend ? (WeekendStart, WeekendEnd) : (WeekdayStart, WeekdayEnd);
        return Session(date, start, end);
    }

    /// <summary>Границы сессии с явными часами (напр. дат-точными из ISS-календаря). МСК+3.</summary>
    public static TradingSession Session(DateOnly date, TimeOnly start, TimeOnly end) => new()
    {
        Date = date,
        Start = new DateTimeOffset(date.ToDateTime(start), MoscowOffset),
        End = new DateTimeOffset(date.ToDateTime(end), MoscowOffset),
        Weekend = date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday,
    };
}
