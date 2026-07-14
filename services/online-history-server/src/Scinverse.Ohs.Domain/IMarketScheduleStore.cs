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

    /// <summary>
    /// Исключения по датам для рынка (market_schedule_exception): отклонения от базы на конкретный день.
    /// Обычно создаются АВТО после сверки с внешним API (Finam/ISS) перед постановкой на запись.
    /// <paramref name="onlyUnresolved"/> = только неразобранные пользователем (resolved = false).
    /// Свежие сверху (по exc_date).
    /// </summary>
    Task<IReadOnlyList<MarketScheduleException>> ListExceptionsAsync(
        string market, bool onlyUnresolved, CancellationToken cancellationToken);
}

/// <summary>
/// Исключение расписания на конкретную дату. Scope-поля (<paramref name="SecType"/>/<paramref name="Category"/>/
/// <paramref name="Instrument"/>) заполнены до того уровня, к которому относится отклонение (null = wildcard).
/// <paramref name="Kind"/>: no_trade|shifted|shortened; окно (<paramref name="OpenTime"/>/<paramref name="CloseTime"/>)
/// задано только для shifted/shortened.
/// </summary>
public sealed record MarketScheduleException(
    DateOnly ExcDate,
    string Market,
    string? SecType,
    string? Category,
    string? Instrument,
    string Kind,
    TimeOnly? OpenTime,
    TimeOnly? CloseTime,
    string Confidence,
    string? Source,
    bool Resolved,
    string? Note);

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
