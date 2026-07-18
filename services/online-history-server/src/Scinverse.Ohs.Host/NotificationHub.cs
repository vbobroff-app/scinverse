using System.Collections.Concurrent;
using System.Text.Json;

namespace Scinverse.Ohs.Host;

/// <summary>
/// In-memory ring-buffer уведомлений + broadcast WS <c>notification</c> (phase 7j / тонкий 11.2).
/// </summary>
public sealed class NotificationHub(WebSocketBroadcaster broadcaster) : INotificationPublisher
{
    public const int DefaultCapacity = 500;

    private readonly ConcurrentQueue<NotificationDto> _buffer = new();
    private int _count;
    private readonly object _gate = new();

    public void Publish(
        string code,
        string message,
        string severity = "info",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null)
    {
        var evt = new NotificationDto(
            Id: Guid.NewGuid().ToString("N"),
            Ts: DateTimeOffset.UtcNow,
            Severity: severity,
            SourceType: sourceType,
            Module: module,
            Code: code,
            Message: message,
            Data: data is null ? null : JsonSerializer.SerializeToElement(data));

        lock (_gate)
        {
            _buffer.Enqueue(evt);
            _count++;
            while (_count > DefaultCapacity && _buffer.TryDequeue(out _))
            {
                _count--;
            }
        }

        broadcaster.Broadcast(new NotificationLiveEvent(evt));
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
    JsonElement? Data);

public sealed record NotificationLiveEvent(NotificationDto Notification) : LiveEvent("notification");
