namespace Scinverse.Ohs.Domain;

/// <summary>Хранилище сегментов покрытия (coverage_segment): open → extend → close.</summary>
public interface ICoverageStore
{
    /// <summary>
    /// Открывает сегмент записи для (instrument, source). Если активный сегмент уже есть,
    /// возвращает его id (идемпотентный старт).
    /// </summary>
    Task<long> OpenAsync(long instrumentId, short sourceId, DateTimeOffset startedAt, CancellationToken cancellationToken);

    /// <summary>Heartbeat: увеличивает trade_count активного сегмента на addedCount.</summary>
    Task ExtendAsync(long segmentId, long addedCount, CancellationToken cancellationToken);

    /// <summary>Закрывает сегмент (ended_at + статус).</summary>
    Task CloseAsync(long segmentId, DateTimeOffset endedAt, string status, CancellationToken cancellationToken);

    /// <summary>
    /// Recovery на старте хоста: закрывает «осиротевшие» открытые сегменты (ended_at IS NULL) прошлого
    /// процесса статусом <c>interrupted</c>, проставляя ended_at = время последней сделки сегмента
    /// (иначе started_at). Возвращает число закрытых сегментов.
    /// </summary>
    Task<int> RecoverOpenSegmentsAsync(CancellationToken cancellationToken);

    /// <summary>Сегменты, пересекающие окно [from, to] (для Ганта покрытия).</summary>
    Task<IReadOnlyList<CoverageSegment>> QuerySegmentsAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken);

    /// <summary>
    /// Внутрисессионные разрывы: пары соседних сделок в окне, между которыми зазор больше порога.
    /// </summary>
    Task<IReadOnlyList<CoverageGap>> QueryGapsAsync(
        long instrumentId, short sourceId, DateTimeOffset from, DateTimeOffset to,
        double thresholdSeconds, CancellationToken cancellationToken);

    /// <summary>
    /// Последние торговые дни (даты в МСК), по которым есть сделки в <c>md_trade</c>. Свежие — первыми.
    /// При <paramref name="includeWeekends"/> == false выходные (сб/вс) исключаются.
    /// </summary>
    Task<IReadOnlyList<DateOnly>> QueryTradingDaysAsync(
        int count, bool includeWeekends, CancellationToken cancellationToken);

    /// <summary>
    /// Границы покрытия по <c>coverage_segment</c>: от самого раннего <c>started_at</c> до
    /// последнего <c>ended_at</c> (для активных сегментов — <c>now()</c>). Для кнопки «All».
    /// </summary>
    Task<CoverageExtent> QueryCoverageExtentAsync(short? sourceId, CancellationToken cancellationToken);
}

/// <summary>Временны́е границы покрытия данными (пустые, если сегментов нет).</summary>
public sealed record CoverageExtent
{
    public DateTimeOffset? From { get; init; }
    public DateTimeOffset? To { get; init; }
}

/// <summary>Внутрисессионный разрыв данных (выводится из md_trade, не хранится).</summary>
public sealed record CoverageGap
{
    public required DateTimeOffset From { get; init; }
    public required DateTimeOffset To { get; init; }
}
