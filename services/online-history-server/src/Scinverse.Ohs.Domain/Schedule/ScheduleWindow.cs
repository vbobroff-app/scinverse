namespace Scinverse.Ohs.Domain.Schedule;

/// <summary>
/// Сведение нейтрального расписания к «торговому окну дня» — общая логика для всех подтверждателей
/// (Finam, ISS): от первого открытия до последнего закрытия торговых/аукционных сессий, НАЧАВШИХСЯ в
/// заданный день (МСК). Клиринг/расчёт/закрытие исключаем (иначе клиринг за полночь «сдвигает» границы).
/// Сравниваем по времени суток (<see cref="TimeOnly"/>), а не по абсолютному моменту.
/// </summary>
public static class ScheduleWindow
{
    private static readonly HashSet<ScheduleSessionKind> OpenKinds =
        [ScheduleSessionKind.Auction, ScheduleSessionKind.Trading];

    /// <summary>Окно (open, close) в МСК на дату. (null, null) = торгов нет.</summary>
    public static (TimeOnly? Open, TimeOnly? Close) Trading(ConfirmerSchedule schedule, DateOnly date)
    {
        var times = schedule.Sessions
            .Where(s => OpenKinds.Contains(s.Kind))
            .Select(s => (
                Start: s.Start.ToOffset(MoexSchedule.MoscowOffset).DateTime,
                End: s.End.ToOffset(MoexSchedule.MoscowOffset).DateTime))
            .Where(s => DateOnly.FromDateTime(s.Start) == date)
            .ToList();

        if (times.Count == 0)
        {
            return (null, null);
        }

        var open = times.Min(s => TimeOnly.FromDateTime(s.Start));
        var close = times.Max(s => TimeOnly.FromDateTime(s.End));
        return (open, close);
    }
}
