namespace Scinverse.Ohs.Domain;

/// <summary>
/// Хранилище внешних сервисов-интеграций (external_service). В отличие от коннектора, секрет
/// персистится в БД (нужен авто-pre-flight без человека) — но наружу отдаётся только признак
/// <see cref="ExternalService.HasSecret"/>; само значение доступно через <see cref="GetSecretAsync"/>
/// (только для адаптера).
/// </summary>
public interface IExternalServiceStore
{
    Task<IReadOnlyList<ExternalService>> ListAsync(CancellationToken cancellationToken);

    Task<ExternalService?> GetAsync(long serviceId, CancellationToken cancellationToken);

    /// <summary>
    /// Создаёт сервис. Имя уникально — при коллизии возвращает null (НЕ перезаписывает существующий),
    /// чтобы «создание» не затирало другую интеграцию. Переименование/правка — через <see cref="UpdateAsync"/>.
    /// </summary>
    Task<ExternalService?> CreateAsync(
        string name, string adapter, string transport, string? secret, DateOnly? secretExpiresOn,
        bool enabled, CancellationToken cancellationToken);

    /// <summary>Обновляет по id (в т.ч. переименование). <paramref name="secret"/> = null → не менять. null, если не найдено.</summary>
    Task<ExternalService?> UpdateAsync(
        long serviceId, string name, string adapter, string transport, string? secret, DateOnly? secretExpiresOn,
        bool enabled, CancellationToken cancellationToken);

    Task<bool> DeleteAsync(long serviceId, CancellationToken cancellationToken);

    /// <summary>Секрет сервиса (для адаптера); null, если сервиса нет или секрет не задан.</summary>
    Task<string?> GetSecretAsync(long serviceId, CancellationToken cancellationToken);

    /// <summary>
    /// Назначенный источник СИСТЕМНОГО расписания (use_for_schedule = true) — confirmer для авто-сверки.
    /// null, если ни одна интеграция не назначена. Эксклюзивность гарантирует ≤1 строку.
    /// </summary>
    Task<ExternalService?> GetScheduleSourceAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Назначить/снять сервис источником системного расписания. При <paramref name="enabled"/> = true —
    /// эксклюзивно (снимает признак с остальных). Возвращает обновлённый сервис или null, если не найден.
    /// </summary>
    Task<ExternalService?> SetScheduleSourceAsync(long serviceId, bool enabled, CancellationToken cancellationToken);
}
