namespace Scinverse.Ohs.Domain;

/// <summary>
/// Курируемая версионная история торгового распорядка ПО ДВИЖКУ (market_schedule, phase 7i/7j):
/// какое расписание действовало на конкретную дату. Меняется редко (ДСВД, ЕТС, расширение 06:50) —
/// строк немного, наполняются вручную/исследовательски. Действующая версия на дату D =
/// строка с max(effective_from) &lt;= D.
/// </summary>
public interface IMarketScheduleStore
{
    /// <summary>
    /// Действующая на дату <paramref name="on"/> базовая версия расписания РЫНКА (market-уровень:
    /// sec_type/category/instrument = NULL) — для UI-вкладки «Расписание». null, если нет.
    /// </summary>
    Task<MarketScheduleVersion?> GetActiveAsync(string market, DateOnly on, CancellationToken cancellationToken);
}

/// <summary>
/// Версия расписания рынка. Внешние границы дня (<paramref name="WdOpen"/>/<paramref name="WdClose"/>)
/// включают аукцион открытия — по ним рисуется «колбаска» Ганта; <paramref name="WeOpen"/>/<paramref name="WeClose"/>
/// — выходные (ДСВД), null = в выходные не торгует. Детальные фазы разложены на будни/выходные.
/// </summary>
public sealed record MarketScheduleVersion(
    string Market,
    DateOnly EffectiveFrom,
    TimeOnly WdOpen,
    TimeOnly WdClose,
    TimeOnly? WeOpen,
    TimeOnly? WeClose,
    IReadOnlyList<SchedulePhase> Weekday,
    IReadOnlyList<SchedulePhase> Weekend,
    string Confidence,
    string? Source,
    string? Note);

/// <summary>Фаза торгового дня: ключ (auction|morning|main|evening|weekend) и границы (МСК).</summary>
public sealed record SchedulePhase(string Key, TimeOnly From, TimeOnly Till);
