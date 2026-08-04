namespace Scinverse.Ohs.Domain;

/// <summary>
/// Lifecycle Online-каталога: актуальность по дате экспирации (не intraday «в сессии»).
/// <c>instrument.active = TRUE</c> — в Online-каталоге; <c>FALSE</c> — архив (просрочен).
/// </summary>
public static class InstrumentLifecycle
{
    /// <summary>
    /// Контракт в Online-каталоге: нет expiration (акции и т.п.) или expiration ≥ сегодня (МСК).
    /// </summary>
    public static bool IsListedOnline(DateOnly? expiration, DateOnly todayMsk) =>
        expiration is null || expiration.Value >= todayMsk;

    /// <summary>Календарная дата «сегодня» в МСК.</summary>
    public static DateOnly TodayMoscow(TimeProvider time)
    {
        var msk = time.GetUtcNow().ToOffset(MoexSchedule.MoscowOffset);
        return DateOnly.FromDateTime(msk.DateTime);
    }
}

/// <summary>Итог суточного/force lifecycle sweep.</summary>
/// <param name="Ran">true — sweep выполнен; false — пропущен (уже был сегодня).</param>
/// <param name="ArchivedInstrumentIds">Инструменты, только что переведённые в архив.</param>
public sealed record InstrumentLifecycleSweepResult(bool Ran, IReadOnlyList<long> ArchivedInstrumentIds);
