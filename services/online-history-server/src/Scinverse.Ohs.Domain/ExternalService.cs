namespace Scinverse.Ohs.Domain;

/// <summary>
/// Внешний сервис (external_service) — интеграция по API (request/response + JWT), в отличие от
/// коннектора (stream + Basic). Пользователь заводит сам в разделе «Интеграции». Секрет в модель
/// НЕ выносим (только признак <see cref="HasSecret"/>); значение читается стором отдельно.
/// </summary>
public sealed record ExternalService
{
    public required long ServiceId { get; init; }

    /// <summary>Свободное имя для UI («Finam REST API»).</summary>
    public required string Name { get; init; }

    /// <summary>Адаптер (биндинг на код): <c>finam</c>.</summary>
    public required string Adapter { get; init; }

    /// <summary>Транспорт адаптера: <c>rest</c>|<c>grpc</c>|<c>ws</c>.</summary>
    public required string Transport { get; init; }

    /// <summary>Задан ли секрет (само значение наружу не отдаём).</summary>
    public required bool HasSecret { get; init; }

    /// <summary>Дата истечения секрета (advisory — для предупреждения), если известна.</summary>
    public DateOnly? SecretExpiresOn { get; init; }

    public required bool Enabled { get; init; }

    /// <summary>
    /// Назначен ли этот сервис источником СИСТЕМНОГО расписания (confirmer для авто-сверки). Эксклюзивно:
    /// одновременно ≤1 интеграции. Capability «schedule», см. docs/dev/phase7i/schedule.md.
    /// </summary>
    public bool UseForSchedule { get; init; }
}
