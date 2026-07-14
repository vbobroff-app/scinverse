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
/// Эвристические часы торгового дня MOEX — только фолбэк, когда ISS-календарь недоступен.
/// <list type="bullet">
/// <item>Будний день: <c>08:50–23:50</c> МСК.</item>
/// <item>Выходной день (ДСВД, с 01.03.2025): <c>09:50–19:00</c> МСК.</item>
/// </list>
/// Авторитетные часы — из ISS (<c>IMarketCalendar</c> / <c>timetable</c>+<c>dailytable</c>).
/// Регламент СР с 14.07.2026 (06:50…) намеренно НЕ хардкодится здесь: ждём обновления ISS и
/// смотрим реакцию системы. См. docs/dev/phase7c/apply.md §3c.
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
