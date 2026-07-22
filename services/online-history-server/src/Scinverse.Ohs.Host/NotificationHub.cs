using System.Collections.Concurrent;
using System.Text.Json;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// In-memory ring-buffer уведомлений + broadcast WS <c>notification</c> (phase 7j / тонкий 11.2) +
/// сдача события в долговременный аудит-лог (<see cref="NotificationPersistQueue"/> → фоновый writer).
/// Плюс оркестратор жизненного цикла (ось B): <see cref="Open"/>/<see cref="Progress"/>/<see cref="Resolve"/>
/// по <c>subject</c>. Единственный источник правды переходов — этот хаб (фронт = проекция upsert).
/// Каждый новый инцидент получает свой <c>correlationId = subject:uid</c> (per-occurrence scope):
/// один и тот же subject, открытый повторно после resolved, получает новый uid — история инцидентов
/// не смешивается, а поиск по префиксу subject собирает их все. Переходы и запись в буфер атомарны
/// под <c>_gate</c> (pessimistic lock), broadcast и persist — вне лока.
/// </summary>
public sealed class NotificationHub(WebSocketBroadcaster broadcaster, NotificationPersistQueue? persist = null)
    : INotificationPublisher
{
    public const int DefaultCapacity = 500;

    /// <summary>Заглушка единственного встроенного оператора до Keycloak (phase 10). Единая точка:
    /// user-события без явного актора атрибутируются сюда; после auth заменится на реальный <c>sub</c>,
    /// <c>'superuser'</c> останется валидным историческим actor_id в старых строках лога.</summary>
    public static readonly NotificationActor Superuser = new("user", "superuser", "Оператор");

    private readonly ConcurrentQueue<NotificationDto> _buffer = new();
    private int _count;
    private readonly object _gate = new();

    /// <summary>Открытые инциденты: subject → (correlationId текущего инцидента, статус active|underway). resolved снимается.</summary>
    private readonly Dictionary<string, (string CorrelationId, string Status)> _openIncidents = new();

    public void Publish(
        string code,
        string message,
        string severity = "info",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null,
        string? status = null,
        string? correlationId = null,
        NotificationActor? actor = null,
        string? subject = null)
    {
        // Одиночное событие; status/correlationId — для продюсер-управляемых последовательностей
        // (напр. фаза connect: connecting→connect/failed одной группой), минуя incident-оркестратор.
        var evt = Enqueue(code, message, severity, sourceType, module, status, correlationId, data, actor, subject);
        Dispatch(evt);
    }

    /// <summary>Открыть/подтвердить инцидент (status=active). Идемпотентно: повторный open активного — no-op.
    /// Новый инцидент по subject получает свежий <c>correlationId = subject:uid</c>.</summary>
    public bool Open(
        string subject,
        string code,
        string message,
        string severity = "warning",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null,
        NotificationActor? actor = null)
        => Transition(subject, "active", code, message, severity, sourceType, module, data, actor,
            canTransition: current => current != "active");

    /// <summary>Пометить восстановление (status=underway). Только для открытого инцидента (active).</summary>
    public bool Progress(
        string subject,
        string code,
        string message,
        string severity = "info",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null,
        NotificationActor? actor = null)
        => Transition(subject, "underway", code, message, severity, sourceType, module, data, actor,
            canTransition: current => current == "active");

    /// <summary>Закрыть инцидент (status=resolved, терминальный). Идемпотентно: повторный resolve — no-op.</summary>
    public bool Resolve(
        string subject,
        string code,
        string message,
        string severity = "ok",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null,
        NotificationActor? actor = null)
        => Transition(subject, "resolved", code, message, severity, sourceType, module, data, actor,
            canTransition: current => current is "active" or "underway");

    private bool Transition(
        string subject,
        string targetStatus,
        string code,
        string message,
        string severity,
        string sourceType,
        string module,
        object? data,
        NotificationActor? actor,
        Func<string?, bool> canTransition)
    {
        NotificationDto? evt;
        lock (_gate)
        {
            var open = _openIncidents.TryGetValue(subject, out var s) ? s : ((string CorrelationId, string Status)?)null;
            if (!canTransition(open?.Status))
            {
                return false; // I2: нет смены статуса — не плодим строку.
            }

            // Открытый инцидент переиспользует свой correlationId; новый (Open по пустому subject) получает subject:uid.
            var correlationId = open?.CorrelationId ?? $"{subject}:{Guid.NewGuid().ToString("N")[..8]}";

            if (targetStatus == "resolved")
            {
                _openIncidents.Remove(subject);
            }
            else
            {
                _openIncidents[subject] = (correlationId, targetStatus);
            }

            evt = EnqueueLocked(code, message, severity, sourceType, module, targetStatus, correlationId, data, actor, subject);
        }

        Dispatch(evt);
        return true;
    }

    private NotificationDto Enqueue(
        string code, string message, string severity, string sourceType, string module,
        string? status, string? correlationId, object? data, NotificationActor? actor, string? subject)
    {
        lock (_gate)
        {
            return EnqueueLocked(code, message, severity, sourceType, module, status, correlationId, data, actor, subject);
        }
    }

    private NotificationDto EnqueueLocked(
        string code, string message, string severity, string sourceType, string module,
        string? status, string? correlationId, object? data, NotificationActor? actor, string? subject)
    {
        var resolvedActor = ResolveActor(actor, sourceType, module);
        var evt = new NotificationDto(
            Id: Guid.NewGuid().ToString("N"),
            Ts: DateTimeOffset.UtcNow,
            Severity: severity,
            SourceType: sourceType,
            Module: module,
            Code: code,
            Message: message,
            Status: status,
            CorrelationId: correlationId,
            Data: data is null ? null : JsonSerializer.SerializeToElement(data),
            Interaction: ResolveInteraction(sourceType),
            Localization: ResolveLocalization(sourceType),
            ActorKind: resolvedActor.Kind,
            ActorId: resolvedActor.Id,
            ActorLabel: resolvedActor.Label,
            Subject: subject);

        _buffer.Enqueue(evt);
        _count++;
        while (_count > DefaultCapacity && _buffer.TryDequeue(out _))
        {
            _count--;
        }

        return evt;
    }

    /// <summary>Broadcast в WS + сдача в аудит-лог. Вне <c>_gate</c> (persist/broadcast не под локом).</summary>
    private void Dispatch(NotificationDto evt)
    {
        persist?.Enqueue(evt);
        broadcaster.Broadcast(new NotificationLiveEvent(evt));
    }

    /// <summary>Прогреть ring-buffer из БД на старте (последние N, oldest-first). Без broadcast/persist:
    /// клиенты берут бэклог через <c>GET /api/notifications</c>, а строки уже в логе.</summary>
    public void Hydrate(IReadOnlyList<NotificationDto> events)
    {
        lock (_gate)
        {
            foreach (var evt in events)
            {
                _buffer.Enqueue(evt);
                _count++;
            }

            while (_count > DefaultCapacity && _buffer.TryDequeue(out _))
            {
                _count--;
            }
        }
    }

    public IReadOnlyList<NotificationDto> List(int? limit = null)
    {
        var all = _buffer.ToArray();
        if (limit is null || limit.Value >= all.Length)
        {
            return all;
        }

        return all.TakeLast(limit.Value).ToArray();
    }

    private static string ResolveInteraction(string sourceType) => sourceType == "user" ? "user" : "system";

    private static string ResolveLocalization(string sourceType) => sourceType == "external" ? "external" : "internal";

    private static NotificationActor ResolveActor(NotificationActor? actor, string sourceType, string module)
        => actor ?? sourceType switch
        {
            "user" => Superuser,
            "external" => new NotificationActor("external", module, module),
            _ => new NotificationActor("system", module, module),
        };
}

public sealed record NotificationDto(
    string Id,
    DateTimeOffset Ts,
    string Severity,
    string SourceType,
    string Module,
    string Code,
    string Message,
    string? Status,
    string? CorrelationId,
    JsonElement? Data,
    string Interaction,
    string Localization,
    string ActorKind,
    string ActorId,
    string ActorLabel,
    string? Subject);

public sealed record NotificationLiveEvent(NotificationDto Notification) : LiveEvent("notification");
