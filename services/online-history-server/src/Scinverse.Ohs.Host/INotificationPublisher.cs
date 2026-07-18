namespace Scinverse.Ohs.Host;

/// <summary>
/// Тонкий срез phase 11.2: публикация событий жизненного цикла в ring-buffer + WS.
/// Одиночные события — <see cref="Publish"/>; инциденты с осью B (active→underway→resolved) —
/// <see cref="Open"/>/<see cref="Progress"/>/<see cref="Resolve"/> по <c>subject</c>. Хаб сам присваивает
/// каждому инциденту per-occurrence <c>correlationId = subject:uid</c>.
/// Полный ILogger-sink / user-actions — перспектива phase 11.
/// </summary>
public interface INotificationPublisher
{
    /// <summary>Одиночное событие. Опц. <paramref name="status"/>/<paramref name="correlationId"/> — для
    /// продюсер-управляемых последовательностей (напр. connecting→connect/failed одной группой), без incident-оркестратора.</summary>
    void Publish(
        string code,
        string message,
        string severity = "info",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null,
        string? status = null,
        string? correlationId = null);

    /// <summary>Открыть/подтвердить инцидент по <paramref name="subject"/> (active). true — если статус сменился (событие ушло).</summary>
    bool Open(
        string subject,
        string code,
        string message,
        string severity = "warning",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null);

    /// <summary>Пометить восстановление (underway) открытого по <paramref name="subject"/> инцидента.</summary>
    bool Progress(
        string subject,
        string code,
        string message,
        string severity = "info",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null);

    /// <summary>Закрыть инцидент по <paramref name="subject"/> (resolved, терминальный).</summary>
    bool Resolve(
        string subject,
        string code,
        string message,
        string severity = "ok",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null);
}
