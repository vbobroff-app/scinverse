namespace Scinverse.Ohs.Domain;

/// <summary>
/// Durable key/value checkpoints Host (переживают рестарт процесса).
/// Используется для гейта суточного checkup / post-dump basket sync.
/// </summary>
public interface IRuntimeStateStore
{
    Task<string?> GetAsync(string key, CancellationToken cancellationToken);

    Task SetAsync(string key, string value, CancellationToken cancellationToken);
}
