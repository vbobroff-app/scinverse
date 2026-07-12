using Scinverse.Ohs.Domain.Moex;

namespace Scinverse.Ohs.Domain;

/// <summary>
/// Строит торговые сессии с реальными (дат-точными) часами MOEX из бесплатного ISS-календаря движка,
/// исключая неторговые дни (праздники). При недоступности ISS откатывается на эвристику
/// <see cref="MoexSchedule"/>. Реализация — в Host (нужен доступ к <see cref="Moex.IExchangeCatalog"/>).
/// </summary>
public interface IMarketCalendar
{
    /// <summary>
    /// Отображает календарные даты (обычно из <c>QueryTradingDaysAsync</c>) в сессии: часы — из
    /// ISS-календаря <paramref name="engine"/> (сокращённые/регламентные), праздники отбрасываются.
    /// </summary>
    Task<IReadOnlyList<TradingSession>> ShapeSessionsAsync(
        string engine, IReadOnlyList<DateOnly> dates, CancellationToken cancellationToken);
}

/// <summary>
/// Чистая логика формирования сессий из <see cref="EngineCalendar"/> (тестируется без сети).
/// </summary>
public static class TradingCalendar
{
    /// <summary>
    /// Строит сессии для <paramref name="dates"/>:
    /// <list type="bullet">
    /// <item>календарь знает дату и это праздник (<c>is_work_day=0</c>) → дата отбрасывается;</item>
    /// <item>будний торговый день → дат-точные внешние часы движка из календаря;</item>
    /// <item>выходной (сб/вс) торговый день → узкое окно ДСВД из <see cref="MoexSchedule"/> (внешнее
    /// окно движка для выходных — общая доступность, слишком широкое);</item>
    /// <item>календарь <c>null</c> или дата ему неизвестна → эвристические часы <see cref="MoexSchedule"/>.</item>
    /// </list>
    /// Порядок дат сохраняется (обычно newest-first).
    /// </summary>
    public static IReadOnlyList<TradingSession> Shape(EngineCalendar? calendar, IReadOnlyList<DateOnly> dates)
    {
        var result = new List<TradingSession>(dates.Count);
        foreach (var date in dates)
        {
            var weekend = date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;

            if (calendar is not null && calendar.TryResolve(date, out var isTrading, out var open, out var close))
            {
                if (!isTrading)
                {
                    continue; // праздник/неторговый — в сессиях не показываем
                }

                result.Add(weekend ? MoexSchedule.Session(date) : MoexSchedule.Session(date, open, close));
            }
            else
            {
                result.Add(MoexSchedule.Session(date)); // эвристический фолбэк
            }
        }

        return result;
    }
}
