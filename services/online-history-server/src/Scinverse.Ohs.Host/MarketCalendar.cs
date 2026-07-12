using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Domain.Moex;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Расписание сессий поверх бесплатного ISS-календаря движка (<see cref="IExchangeCatalog.GetEngineCalendarAsync"/>).
/// Часы дней — дат-точные (сокращённые/регламентные), праздники исключаются; при недоступности ISS
/// прозрачно откатывается на эвристику <see cref="MoexSchedule"/> (лог warn). Формирование — чистый
/// <see cref="TradingCalendar.Shape"/>.
/// </summary>
public sealed class MarketCalendar(IExchangeCatalog catalog, ILogger<MarketCalendar> logger) : IMarketCalendar
{
    public async Task<IReadOnlyList<TradingSession>> ShapeSessionsAsync(
        string engine, IReadOnlyList<DateOnly> dates, CancellationToken cancellationToken)
    {
        if (dates.Count == 0)
        {
            return [];
        }

        EngineCalendar? calendar = null;
        try
        {
            calendar = await catalog.GetEngineCalendarAsync(engine, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            logger.LogWarning(ex, "ISS-календарь движка {Engine} недоступен — откат на MoexSchedule", engine);
        }

        return TradingCalendar.Shape(calendar, dates);
    }
}
