namespace Scinverse.Ohs.Domain;

/// <summary>
/// Актор события — кто/что породило уведомление (phase 11.2 persistence). Паттерн «ссылка + снимок»:
/// <see cref="Id"/> — стабильная ссылка на принципала (user → Keycloak <c>sub</c>, phase 10; system →
/// сервис/модуль; external → коннектор/source), <see cref="Label"/> — НЕИЗМЕНЯЕМЫЙ снимок отображаемого
/// имени на момент события (чтобы лог не врал после переименования/удаления пользователя).
/// </summary>
public sealed record NotificationActor(string Kind, string Id, string Label);

/// <summary>
/// Строка долговременного аудит-лога уведомлений (таблица <c>notification</c>, V025). Зеркалит событие
/// ленты Notification Center + материализует оси атрибуции (<see cref="Interaction"/>/
/// <see cref="Localization"/>) и актор-след. Секреты не хранятся (гарантия продюсера).
/// </summary>
public sealed record NotificationRecord
{
    /// <summary>Уникальный id события (= NotificationDto.Id, Guid).</summary>
    public required Guid EventId { get; init; }

    /// <summary>Время события (UTC).</summary>
    public required DateTimeOffset Ts { get; init; }

    /// <summary>ok | info | warning | error | critical.</summary>
    public required string Severity { get; init; }

    /// <summary>user | system | external (legacy-ось источника).</summary>
    public required string SourceType { get; init; }

    /// <summary>Кто инициировал: user | system (материализовано из sourceType, если не задано явно).</summary>
    public required string Interaction { get; init; }

    /// <summary>Контур: internal | external.</summary>
    public required string Localization { get; init; }

    /// <summary>Ось B (жизненный цикл): active | underway | resolved; null — дискретное событие.</summary>
    public string? Status { get; init; }

    /// <summary>Логический модуль-источник, напр. <c>ohs.connection</c>.</summary>
    public required string Module { get; init; }

    /// <summary>Стабильный машинный код, напр. <c>connection.schedule.rule_set</c>.</summary>
    public required string Code { get; init; }

    /// <summary>Человекочитаемое сообщение (без секретов).</summary>
    public required string Message { get; init; }

    /// <summary>Квалификатор инцидента без <c>:uid</c> (для поиска); null для дискретных событий.</summary>
    public string? Subject { get; init; }

    /// <summary><c>subject:uid</c> — история одного инцидента.</summary>
    public string? CorrelationId { get; init; }

    /// <summary>Класс актора: user | system | external.</summary>
    public required string ActorKind { get; init; }

    /// <summary>Ссылка на актора (Keycloak sub / сервис / коннектор).</summary>
    public required string ActorId { get; init; }

    /// <summary>Снимок отображаемого имени актора на момент события.</summary>
    public required string ActorLabel { get; init; }

    /// <summary>Контекст события как JSON-текст (jsonb); null — если нет.</summary>
    public string? Data { get; init; }
}
