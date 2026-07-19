namespace Scinverse.Ohs.Domain;

/// <summary>Черновик правила для upsert (phase 7j v2).</summary>
public sealed record ConnectionScheduleRuleDraft
{
    public required string ScopeKind { get; init; }
    public int? DowMask { get; init; }
    public DateOnly? DateFrom { get; init; }
    public DateOnly? DateTo { get; init; }
    public required string Mode { get; init; }
    public TimeOnly? OpenTime { get; init; }
    public int? DurationMin { get; init; }
    public required string ChangeSource { get; init; }
    public string? ChangeNote { get; init; }
}

/// <summary>Итог upsert правила: новая версия + закрытые как <c>superseded</c> (по вложенности скоупа).</summary>
public sealed record UpsertRuleResult(
    ConnectionScheduleRule Rule,
    IReadOnlyList<long> SupersededIds);

/// <summary>Хранилище расписаний соединений (connection_schedule / _settings), phase 7j v2.</summary>
public interface IConnectionScheduleStore
{
    /// <summary>Настройки + все живые правила подключения (настройки по умолчанию, если строки нет).</summary>
    Task<ConnectionScheduleState> GetStateAsync(long connectionId, CancellationToken cancellationToken);

    /// <summary>Настройки подключения (по умолчанию, если строки нет).</summary>
    Task<ConnectionScheduleSettings> GetSettingsAsync(long connectionId, CancellationToken cancellationToken);

    /// <summary>Живые правила подключения (<c>effective_to IS NULL</c>).</summary>
    Task<IReadOnlyList<ConnectionScheduleRule>> ListLiveRulesAsync(
        long connectionId, CancellationToken cancellationToken);

    /// <summary>Полная история версий правил подключения.</summary>
    Task<IReadOnlyList<ConnectionScheduleRule>> ListHistoryAsync(
        long connectionId, CancellationToken cancellationToken);

    /// <summary>Состояния всех подключений с включённым Auto — для супервизора.</summary>
    Task<IReadOnlyList<ConnectionScheduleState>> ListAutoEnabledAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Upsert правила (SCD-2). Закрывает как <c>superseded</c> все живые правила того же уровня,
    /// чей скоуп полностью вложен в новый (для dow — <c>Mold ⊆ Mnew</c>), и вставляет новую версию.
    /// </summary>
    Task<UpsertRuleResult> UpsertRuleAsync(
        long connectionId, ConnectionScheduleRuleDraft draft, CancellationToken cancellationToken);

    /// <summary>Снять правило: закрыть живую версию как <c>canceled</c>. null — если не найдено/уже закрыто.</summary>
    Task<ConnectionScheduleRule?> CancelRuleAsync(
        long connectionId, long scheduleId, CancellationToken cancellationToken);

    /// <summary>Upsert настроек (заданные поля перезаписывают, null — оставляют прежнее/дефолт).</summary>
    Task<ConnectionScheduleSettings> SetSettingsAsync(
        long connectionId, bool? autoEnabled, string? engine, string? tz, CancellationToken cancellationToken);

    /// <summary>Быстрый тумблер Auto (создаёт строку настроек при отсутствии).</summary>
    Task<ConnectionScheduleSettings> SetAutoAsync(
        long connectionId, bool autoEnabled, CancellationToken cancellationToken);
}
