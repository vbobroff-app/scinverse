namespace Scinverse.Ohs.Domain;

/// <summary>
/// Строка журнала инцидентов (таблица <c>incident</c>, phase 11.13). Одна строка = один
/// <see cref="CorrUid"/> / эпизод open→terminal. Не путать с атомами <c>notification</c> (лента NC).
/// </summary>
public sealed record Incident
{
    /// <summary>= correlationId NC (<c>subject:uid</c>).</summary>
    public required string CorrUid { get; init; }

    /// <summary>Модуль-продюсер: connection | api | writer | …</summary>
    public required string Module { get; init; }

    /// <summary>Вид внутри модуля; у connection: break | crash.</summary>
    public required string Type { get; init; }

    /// <summary>active | recovering | resolved.</summary>
    public required string Status { get; init; }

    /// <summary>recovered | recovered_manual | abandoned_schedule | abandoned_manual; null пока open.</summary>
    public string? CloseOutcome { get; init; }

    public required DateTimeOffset OpenedAt { get; init; }

    public DateTimeOffset? ClosedAt { get; init; }

    /// <summary>Префикс corr без uid.</summary>
    public required string Subject { get; init; }

    /// <summary>ok | info | warning | error | critical.</summary>
    public required string Severity { get; init; }

    public string Title { get; init; } = "";

    public required DateTimeOffset LastActivityAt { get; init; }

    /// <summary>
    /// Break: 1:1 connection. Crash (P5): обычно null — scope в <c>incident_connection</c>.
    /// </summary>
    public long? ConnectionId { get; init; }

    public short? SourceId { get; init; }

    /// <summary>Handover TRANSAQ→supervisor (раскраска жёлтое|красное).</summary>
    public DateTimeOffset? EscalatedAt { get; init; }

    /// <summary>degraded | down | host_unavailable | …</summary>
    public string? Subtype { get; init; }

    /// <summary>transaq | supervisor | admin.</summary>
    public string? Owner { get; init; }

    /// <summary>Прочий контекст как JSON-текст (jsonb); null если нет.</summary>
    public string? Payload { get; init; }

    /// <summary>Soft-delete: когда скрыт; null = видим.</summary>
    public DateTimeOffset? DeletedAt { get; init; }

    /// <summary>Кто soft-delete (оператор / superuser).</summary>
    public string? DeletedBy { get; init; }
}

/// <summary>Фильтр списка журнала / окна ribbon.</summary>
public sealed record IncidentQuery
{
    public string? Module { get; init; }
    public string? Status { get; init; }

    /// <summary>Мульти-статус (модалка); если задан — приоритетнее <see cref="Status"/>.</summary>
    public IReadOnlyList<string>? Statuses { get; init; }

    public string? Type { get; init; }

    /// <summary>Мульти close_outcome: recovered / recovered_manual / abandoned_manual.</summary>
    public IReadOnlyList<string>? CloseOutcomes { get; init; }

    public long? ConnectionId { get; init; }
    public DateTimeOffset? From { get; init; }
    public DateTimeOffset? To { get; init; }
    public int Limit { get; init; } = 100;
    public int Offset { get; init; }

    /// <summary>По умолчанию false — скрыть soft-deleted (ribbon всегда false).</summary>
    public bool IncludeDeleted { get; init; }
}

/// <summary>Страница журнала инцидентов: элементы + общее число под фильтром.</summary>
public sealed record IncidentPage(
    IReadOnlyList<Incident> Items,
    int Total,
    int Limit,
    int Offset);
