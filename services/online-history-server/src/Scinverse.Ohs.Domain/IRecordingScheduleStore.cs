namespace Scinverse.Ohs.Domain;

/// <summary>Хранилище политик автозаписи (recording_schedule).</summary>
public interface IRecordingScheduleStore
{
    Task<IReadOnlyList<RecordingScheduleEntry>> ListAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<RecordingScheduleEntry>> ListEnabledAsync(CancellationToken cancellationToken);

    /// <summary>Upsert пакета политик. Возвращает актуальное состояние затронутых строк.</summary>
    Task<IReadOnlyList<RecordingScheduleEntry>> UpsertAsync(
        IReadOnlyList<RecordingScheduleEntry> entries, CancellationToken cancellationToken);

    /// <summary>Снимает Auto с инструмента (ручной Стоп). No-op, если строки нет.</summary>
    Task DisableAutoAsync(long instrumentId, CancellationToken cancellationToken);

    /// <summary>Снимает Auto с набора инструментов (соседи серии).</summary>
    Task DisableAutoManyAsync(IReadOnlyList<long> instrumentIds, CancellationToken cancellationToken);
}
