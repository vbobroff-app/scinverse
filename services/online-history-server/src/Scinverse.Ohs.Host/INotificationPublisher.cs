using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Тонкий срез phase 11.2: публикация событий жизненного цикла в ring-buffer + WS (+ долговременный
/// аудит-лог, phase 11.2 persistence). Одиночные события — <see cref="Publish"/>; инциденты с осью B
/// (active→underway→resolved) — <see cref="Open"/>/<see cref="Progress"/>/<see cref="Resolve"/> по
/// <c>subject</c>. Хаб сам присваивает каждому инциденту per-occurrence <c>correlationId = subject:uid</c>.
/// Опц. <paramref name="actor"/> — кто/что породило (user → позже Keycloak-принципал; по умолчанию для
/// user-событий = <see cref="NotificationHub.Superuser"/>, для system/external выводится из module).
/// </summary>
public interface INotificationPublisher
{
    /// <summary>Одиночное событие. Опц. <paramref name="status"/>/<paramref name="correlationId"/> — для
    /// продюсер-управляемых последовательностей (напр. connecting→connect/failed одной группой), без incident-оркестратора.
    /// <paramref name="subject"/> — квалификатор инцидента для аудита (без <c>:uid</c>).</summary>
    void Publish(
        string code,
        string message,
        string severity = "info",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null,
        string? status = null,
        string? correlationId = null,
        NotificationActor? actor = null,
        string? subject = null);

    /// <summary>Открыть/подтвердить инцидент по <paramref name="subject"/> (active). true — если статус сменился (событие ушло).</summary>
    bool Open(
        string subject,
        string code,
        string message,
        string severity = "warning",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null,
        NotificationActor? actor = null);

    /// <summary>Пометить восстановление (underway) открытого по <paramref name="subject"/> инцидента.</summary>
    bool Progress(
        string subject,
        string code,
        string message,
        string severity = "info",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null,
        NotificationActor? actor = null);

    /// <summary>Закрыть инцидент по <paramref name="subject"/> (resolved, терминальный).</summary>
    bool Resolve(
        string subject,
        string code,
        string message,
        string severity = "ok",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null,
        NotificationActor? actor = null);
}
