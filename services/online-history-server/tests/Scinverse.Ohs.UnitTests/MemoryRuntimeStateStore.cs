using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

internal sealed class MemoryRuntimeStateStore : IRuntimeStateStore
{
    private readonly Dictionary<string, string> _values = new(StringComparer.Ordinal);

    public Task<string?> GetAsync(string key, CancellationToken cancellationToken)
    {
        lock (_values)
        {
            return Task.FromResult(_values.TryGetValue(key, out var value) ? value : null);
        }
    }

    public Task SetAsync(string key, string value, CancellationToken cancellationToken)
    {
        lock (_values)
        {
            _values[key] = value;
        }

        return Task.CompletedTask;
    }
}
