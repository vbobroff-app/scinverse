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
}
