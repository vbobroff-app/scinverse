using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Ingestion;

/// <inheritdoc />
public sealed class InstrumentRegistry(IInstrumentStore store, IDerivativeSpecParser derivativeParser)
    : IInstrumentRegistry
{
    private readonly ConcurrentDictionary<InstrumentKey, Instrument> _cache = new();

    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        var instruments = await store.LoadAllAsync(cancellationToken).ConfigureAwait(false);
        foreach (var instrument in instruments)
        {
            _cache[instrument.Key] = instrument;
        }
    }

    public async Task<Instrument> RegisterAsync(SecurityInfo security, CancellationToken cancellationToken)
    {
        var enriched = Enrich(security);
        var instrument = await store.UpsertAsync(enriched, cancellationToken).ConfigureAwait(false);
        _cache[instrument.Key] = instrument;
        return instrument;
    }

    /// <summary>Дополняет справку атрибутами дериватива, выведенными из кода (FORTS).</summary>
    private SecurityInfo Enrich(SecurityInfo security)
    {
        if (security.UnderlyingCode is not null
            || !derivativeParser.TryParse(security.Key, security.SecType,
                   DateOnly.FromDateTime(DateTime.UtcNow), out var spec))
        {
            return security;
        }

        return security with
        {
            UnderlyingCode = spec.UnderlyingCode,
            UnderlyingFuturesCode = spec.UnderlyingFuturesCode,
            Expiration = spec.Expiration,
            OptionType = spec.OptionType,
            Strike = spec.Strike
        };
    }

    public bool TryResolve(InstrumentKey key, [MaybeNullWhen(false)] out Instrument instrument) =>
        _cache.TryGetValue(key, out instrument);

    public bool TryResolveById(long instrumentId, [MaybeNullWhen(false)] out Instrument instrument)
    {
        foreach (var candidate in _cache.Values)
        {
            if (candidate.InstrumentId == instrumentId)
            {
                instrument = candidate;
                return true;
            }
        }

        instrument = null;
        return false;
    }
}
