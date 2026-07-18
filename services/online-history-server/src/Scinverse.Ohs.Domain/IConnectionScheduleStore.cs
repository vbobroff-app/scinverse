namespace Scinverse.Ohs.Domain;

/// <summary>Хранилище расписаний соединений (connection_schedule), phase 7j.</summary>
public interface IConnectionScheduleStore
{
    Task<ConnectionScheduleEntry?> GetCurrentAsync(long connectionId, CancellationToken cancellationToken);

    Task<IReadOnlyList<ConnectionScheduleEntry>> ListCurrentScheduledAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<ConnectionScheduleEntry>> ListHistoryAsync(
        long connectionId, CancellationToken cancellationToken);

    /// <summary>
    /// Публикует новую версию окна (SCD-2): закрывает текущую и вставляет новую.
    /// Если текущей нет — просто INSERT. <paramref name="mode"/> задаёт Auto на новой строке.
    /// </summary>
    Task<ConnectionScheduleEntry> PublishWindowAsync(
        long connectionId,
        string mode,
        TimeOnly windowStart,
        TimeOnly windowEnd,
        string engine,
        string tz,
        string changeSource,
        string? changeNote,
        CancellationToken cancellationToken);

    /// <summary>Обновляет <c>mode</c> текущей версии. Нет текущей — null.</summary>
    Task<ConnectionScheduleEntry?> SetModeAsync(
        long connectionId, string mode, CancellationToken cancellationToken);
}
