namespace Scinverse.Ohs.Domain.Moex;

/// <summary>
/// Описание одного дня календаря движка: торговый ли день, выходной (сб/вс), было ли исключение
/// (строка в <c>dailytable</c>) и внешние часы дня (МСК; заполнены только у торгового дня).
/// </summary>
public readonly record struct EngineCalendarDay(
    bool IsTrading, bool Weekend, bool Exception, TimeOnly? Open, TimeOnly? Close);

/// <summary>
/// Машиночитаемый календарь торгового движка MOEX из бесплатного <c>/iss/engines/{engine}</c>:
/// недельное расписание (<c>timetable</c>) + исключения по датам (<c>dailytable</c>: праздники,
/// переносы, сокращённые дни, вкл. будущие). Исключение даты имеет приоритет над правилом недели.
/// Чистая модель без сети — разрешает дату в «торговый день?» + внешние границы дня (МСК).
/// </summary>
public sealed class EngineCalendar
{
    // Недельное правило по ISS week_day 1..7 (1=Пн … 7=Вс); индекс 0 не используется.
    private readonly WeekRule?[] _weekly;
    private readonly IReadOnlyDictionary<DateOnly, DayRule> _daily;

    private EngineCalendar(WeekRule?[] weekly, IReadOnlyDictionary<DateOnly, DayRule> daily)
    {
        _weekly = weekly;
        _daily = daily;
    }

    private readonly record struct WeekRule(bool Work, TimeOnly? Start, TimeOnly? End);

    private readonly record struct DayRule(bool Work, TimeOnly? Start, TimeOnly? End);

    /// <summary>
    /// Собирает календарь из строк ISS: <paramref name="timetable"/> (<c>week_day</c> 1..7) и
    /// <paramref name="dailytable"/> (исключения по датам). Дубликаты дат — последняя запись выигрывает.
    /// </summary>
    public static EngineCalendar Build(
        IEnumerable<(int WeekDay, bool Work, TimeOnly? Start, TimeOnly? End)> timetable,
        IEnumerable<(DateOnly Date, bool Work, TimeOnly? Start, TimeOnly? End)> dailytable)
    {
        var weekly = new WeekRule?[8];
        foreach (var (weekDay, work, start, end) in timetable)
        {
            if (weekDay is >= 1 and <= 7)
            {
                weekly[weekDay] = new WeekRule(work, start, end);
            }
        }

        var daily = new Dictionary<DateOnly, DayRule>();
        foreach (var (date, work, start, end) in dailytable)
        {
            daily[date] = new DayRule(work, start, end);
        }

        return new EngineCalendar(weekly, daily);
    }

    /// <summary>
    /// Разрешает дату. Возвращает <c>false</c>, если календарь её не знает (нет ни исключения, ни
    /// правила недели) — вызывающий откатывается на эвристику. Иначе <c>true</c> и заполняет
    /// <paramref name="isTrading"/> (торговый ли день) и внешние границы дня (МСК) при торговом дне.
    /// </summary>
    public bool TryResolve(DateOnly date, out bool isTrading, out TimeOnly open, out TimeOnly close)
    {
        open = default;
        close = default;
        isTrading = false;

        var iso = date.DayOfWeek == DayOfWeek.Sunday ? 7 : (int)date.DayOfWeek; // Вс(0)→7
        var week = _weekly[iso];

        // Исключение по дате перекрывает недельное правило.
        if (_daily.TryGetValue(date, out var day))
        {
            isTrading = day.Work;
            if (!isTrading)
            {
                return true; // праздник/неторговый день
            }

            if (day.Start is { } ds && day.End is { } de)
            {
                (open, close) = (ds, de);
            }
            else if (week is { Start: { } ws, End: { } we })
            {
                (open, close) = (ws, we); // перенос без своих часов → часы недели
            }
            else
            {
                (open, close) = (new TimeOnly(0, 0), new TimeOnly(23, 59, 59));
            }

            return true;
        }

        if (week is { } w)
        {
            isTrading = w.Work;
            if (isTrading && w.Start is { } s && w.End is { } e)
            {
                (open, close) = (s, e);
            }

            return true;
        }

        return false; // календарь не знает дату
    }

    /// <summary>
    /// Полное описание дня для UI-календаря: торговый/неторговый, выходной, исключение и часы.
    /// Если календарь не знает дату — трактует по дню недели (будни торгуются, сб/вс — нет), без часов.
    /// </summary>
    public EngineCalendarDay Describe(DateOnly date)
    {
        var weekend = date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;
        var exception = _daily.ContainsKey(date);

        if (TryResolve(date, out var trading, out var open, out var close))
        {
            return new EngineCalendarDay(
                trading, weekend, exception,
                trading ? open : null,
                trading ? close : null);
        }

        return new EngineCalendarDay(!weekend, weekend, exception, null, null);
    }
}
