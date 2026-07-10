using System.Collections.Concurrent;

namespace Scinverse.Ohs.Connectors.Transaq;

/// <inheritdoc />
public sealed class InMemoryCredentialStore : ICredentialStore
{
    private readonly ConcurrentDictionary<long, ConnectorCredentials> _store = new();

    public void Set(long connectionId, ConnectorCredentials credentials) => _store[connectionId] = credentials;

    public bool TryGet(long connectionId, out ConnectorCredentials credentials) =>
        _store.TryGetValue(connectionId, out credentials!);

    public void Clear(long connectionId) => _store.TryRemove(connectionId, out _);
}
