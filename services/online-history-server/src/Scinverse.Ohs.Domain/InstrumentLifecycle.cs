namespace Scinverse.Ohs.Domain;

/// <summary>
/// Lifecycle Online-каталога: актуальность по дате экспирации (не intraday «в сессии»).
/// <c>instrument.active = TRUE</c> — в Online-каталоге; <c>FALSE</c> — архив (просрочен).
/// </summary>
public static class InstrumentLifecycle
{
    /// <summary>
    /// Interim-граница checkup-суток (МСК): ≥04:00 — «утро» (3 ночи ещё вчера, 4 — уже новый день).
    /// До появления единого schedule — хардкод; потом = OpenTime окна.
    /// </summary>
    public static readonly TimeOnly CheckupDayCutoverMoscow = new(4, 0);

    /// <summary>
    /// Контракт в Online-каталоге: нет expiration (акции и т.п.) или expiration ≥ сегодня (МСК).
    /// </summary>
    public static bool IsListedOnline(DateOnly? expiration, DateOnly todayMsk) =>
        expiration is null || expiration.Value >= todayMsk;

    /// <summary>Календарная дата «сегодня» в МСК (экспирация / archive).</summary>
    public static DateOnly TodayMoscow(TimeProvider time)
    {
        var msk = time.GetUtcNow().ToOffset(MoexSchedule.MoscowOffset);
        return DateOnly.FromDateTime(msk.DateTime);
    }

    /// <summary>
    /// День checkup / первого connect: с <see cref="CheckupDayCutoverMoscow"/> (включительно).
    /// 00:30 принадлежит вчерашнему checkup-дню; 06:00 — новый день.
    /// </summary>
    public static DateOnly CheckupDayMoscow(TimeProvider time) =>
        CheckupDayMoscow(time.GetUtcNow().ToOffset(MoexSchedule.MoscowOffset).DateTime);

    /// <summary>То же для явного локального МСК-момента (тесты).</summary>
    public static DateOnly CheckupDayMoscow(DateTime mskLocal)
    {
        var date = DateOnly.FromDateTime(mskLocal);
        var tod = TimeOnly.FromDateTime(mskLocal);
        return tod < CheckupDayCutoverMoscow ? date.AddDays(-1) : date;
    }
}

/// <summary>Итог суточного/force lifecycle sweep.</summary>
/// <param name="Ran">true — sweep выполнен; false — пропущен (уже был сегодня).</param>
/// <param name="ArchivedInstrumentIds">Инструменты, только что переведённые в архив.</param>
/// <param name="RemovedFromBaskets">Убраны из static members при re-eval сразу после archive.</param>
public sealed record InstrumentLifecycleSweepResult(
    bool Ran,
    IReadOnlyList<long> ArchivedInstrumentIds,
    IReadOnlyList<BasketMemberChange>? RemovedFromBaskets = null)
{
    public IReadOnlyList<BasketMemberChange> Removals => RemovedFromBaskets ?? [];
}
