namespace Scinverse.Ohs.Host;

/// <summary>
/// Тонкий срез phase 11.2: публикация событий жизненного цикла в ring-buffer + WS.
/// Одиночные события — <see cref="Publish"/>; инциденты с осью B (active→underway→resolved) —
/// <see cref="Open"/>/<see cref="Progress"/>/<see cref="Resolve"/> по <c>correlationId</c>.
/// Полный ILogger-sink / user-actions — перспектива phase 11.
/// </summary>
public interface INotificationPublisher
{
    /// <summary>Одиночное событие без жизненного цикла.</summary>
    void Publish(
        string code,
        string message,
        string severity = "info",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null);

    /// <summary>Открыть/подтвердить инцидент (active). true — если статус сменился (событие ушло).</summary>
    bool Open(
        string correlationId,
        string code,
        string message,
        string severity = "warning",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null);

    /// <summary>Пометить восстановление (underway) открытого инцидента.</summary>
    bool Progress(
        string correlationId,
        string code,
        string message,
        string severity = "info",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null);

    /// <summary>Закрыть инцидент (resolved, терминальный).</summary>
    bool Resolve(
        string correlationId,
        string code,
        string message,
        string severity = "ok",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null);
}
