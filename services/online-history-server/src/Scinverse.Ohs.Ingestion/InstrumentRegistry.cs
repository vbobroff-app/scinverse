using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Ingestion;

/// <inheritdoc />
public sealed class InstrumentRegistry : IInstrumentRegistry
{
    private readonly IInstrumentStore _store;
    private readonly ConcurrentDictionary<InstrumentKey, Instrument> _cache = new();

    public InstrumentRegistry(IInstrumentStore store) => _store = store;

    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        var instruments = await _store.LoadAllAsync(cancellationToken).ConfigureAwait(false);
        foreach (var instrument in instruments)
        {
            _cache[instrument.Key] = instrument;
        }
    }

    public async Task<Instrument> RegisterAsync(SecurityInfo security, CancellationToken cancellationToken)
    {
        var instrument = await _store.UpsertAsync(security, cancellationToken).ConfigureAwait(false);
        _cache[instrument.Key] = instrument;
        return instrument;
    }

    public bool TryResolve(InstrumentKey key, [MaybeNullWhen(false)] out Instrument instrument) =>
        _cache.TryGetValue(key, out instrument);
}
