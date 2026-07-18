using System.Collections.Concurrent;
using System.Text.Json;

namespace Scinverse.Ohs.Host;

/// <summary>
/// In-memory ring-buffer уведомлений + broadcast WS <c>notification</c> (phase 7j / тонкий 11.2).
/// Плюс оркестратор жизненного цикла (ось B): <see cref="Open"/>/<see cref="Progress"/>/<see cref="Resolve"/>
/// по <c>subject</c>. Единственный источник правды переходов — этот хаб (фронт = проекция upsert).
/// Каждый новый инцидент получает свой <c>correlationId = subject:uid</c> (per-occurrence scope):
/// один и тот же subject, открытый повторно после resolved, получает новый uid — история инцидентов
/// не смешивается, а поиск по префиксу subject собирает их все. Переходы и запись в буфер атомарны
/// под <c>_gate</c> (pessimistic lock), broadcast — вне лока.
/// </summary>
public sealed class NotificationHub(WebSocketBroadcaster broadcaster) : INotificationPublisher
{
    public const int DefaultCapacity = 500;

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
        object? data = null)
    {
        var evt = Enqueue(code, message, severity, sourceType, module, status: null, correlationId: null, data);
        broadcaster.Broadcast(new NotificationLiveEvent(evt));
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
        object? data = null)
        => Transition(subject, "active", code, message, severity, sourceType, module, data,
            canTransition: current => current != "active");

    /// <summary>Пометить восстановление (status=underway). Только для открытого инцидента (active).</summary>
    public bool Progress(
        string subject,
        string code,
        string message,
        string severity = "info",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null)
        => Transition(subject, "underway", code, message, severity, sourceType, module, data,
            canTransition: current => current == "active");

    /// <summary>Закрыть инцидент (status=resolved, терминальный). Идемпотентно: повторный resolve — no-op.</summary>
    public bool Resolve(
        string subject,
        string code,
        string message,
        string severity = "ok",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null)
        => Transition(subject, "resolved", code, message, severity, sourceType, module, data,
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

            evt = EnqueueLocked(code, message, severity, sourceType, module, targetStatus, correlationId, data);
        }

        broadcaster.Broadcast(new NotificationLiveEvent(evt));
        return true;
    }

    private NotificationDto Enqueue(
        string code, string message, string severity, string sourceType, string module,
        string? status, string? correlationId, object? data)
    {
        lock (_gate)
        {
            return EnqueueLocked(code, message, severity, sourceType, module, status, correlationId, data);
        }
    }

    private NotificationDto EnqueueLocked(
        string code, string message, string severity, string sourceType, string module,
        string? status, string? correlationId, object? data)
    {
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
            Data: data is null ? null : JsonSerializer.SerializeToElement(data));

        _buffer.Enqueue(evt);
        _count++;
        while (_count > DefaultCapacity && _buffer.TryDequeue(out _))
        {
            _count--;
        }

        return evt;
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
    JsonElement? Data);

public sealed record NotificationLiveEvent(NotificationDto Notification) : LiveEvent("notification");
