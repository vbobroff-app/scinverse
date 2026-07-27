namespace Scinverse.Ohs.Domain;

/// <summary>Долговременный аудит-лог уведомлений (таблица <c>notification</c>, phase 11.2 persistence).</summary>
public interface INotificationStore
{
    /// <summary>Пакетная append-запись (идемпотентно по <c>event_id</c>: <c>ON CONFLICT DO NOTHING</c>).</summary>
    Task AppendBatchAsync(IReadOnlyCollection<NotificationRecord> records, CancellationToken cancellationToken);

    /// <summary>Последние <paramref name="limit"/> событий, отсортированные по возрастанию времени (oldest-first).</summary>
    Task<IReadOnlyList<NotificationRecord>> QueryRecentAsync(int limit, CancellationToken cancellationToken);

    /// <summary>
    /// Последний открытый break по подключению: subject <c>connection:{id}:link</c>, latest status
    /// по corr ∈ {active, underway}. <c>null</c> — нет open (или уже resolved). I10 adopt/catch-up.
    /// </summary>
    Task<OpenLinkIncident?> FindOpenLinkIncidentAsync(long connectionId, CancellationToken cancellationToken);
}
