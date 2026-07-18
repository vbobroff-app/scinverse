namespace Scinverse.Ohs.Host;

/// <summary>
/// Тонкий срез phase 11.2: публикация событий жизненного цикла в ring-buffer + WS.
/// Полный ILogger-sink / user-actions — перспектива phase 11.
/// </summary>
public interface INotificationPublisher
{
    void Publish(
        string code,
        string message,
        string severity = "info",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null);
}
