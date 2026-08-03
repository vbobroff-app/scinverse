using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Ingestion;

/// <inheritdoc />
public sealed class InstrumentRegistry(
    IInstrumentStore store,
    IDerivativeSpecParser derivativeParser,
    InstrumentCatalogPersistQueue persistQueue,
    TimeProvider time) : IInstrumentRegistry
{
    public const int MissBatchSize = 500;

    private readonly ConcurrentDictionary<InstrumentKey, Instrument> _cache = new();
    private readonly object _missGate = new();
    private List<SecurityInfo> _missBuffer = new(MissBatchSize);
    private readonly object _freshGate = new();
    private bool _stale;
    private DateOnly? _lastInvalidationDay;

    public bool IsFresh
    {
        get { lock (_freshGate) return !_stale; }
    }

    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        var instruments = await store.LoadAllAsync(cancellationToken).ConfigureAwait(false);
        foreach (var instrument in instruments)
        {
            _cache[instrument.Key] = instrument;
        }

        MarkFresh();
    }

    public void Observe(SecurityInfo security)
    {
        var enriched = Enrich(security);

        if (_cache.TryGetValue(enriched.Key, out var existing))
        {
            if (IsFresh)
            {
                return;
            }

            var updated = existing with
            {
                MinStep = enriched.MinStep,
                Decimals = enriched.Decimals,
                LotSize = enriched.LotSize
            };
            _cache[enriched.Key] = updated;
            EnqueuePersist(enriched);
            return;
        }

        lock (_missGate)
        {
            _missBuffer.Add(enriched);
        }
    }

    public async Task FlushPendingAsync(CancellationToken cancellationToken)
    {
        List<SecurityInfo> batch;
        lock (_missGate)
        {
            if (_missBuffer.Count == 0)
            {
                return;
            }

            batch = _missBuffer;
            _missBuffer = new List<SecurityInfo>(MissBatchSize);
        }

        await PersistMissBatchAsync(batch, cancellationToken).ConfigureAwait(false);
    }

    public async Task<Instrument> RegisterAsync(SecurityInfo security, CancellationToken cancellationToken)
    {
        Observe(security);
        await FlushPendingAsync(cancellationToken).ConfigureAwait(false);

        var key = Enrich(security).Key;
        if (_cache.TryGetValue(key, out var instrument))
        {
            return instrument;
        }

        // На всякий случай (очередь DropOldest / гонка): прямой upsert.
        instrument = await store.UpsertAsync(Enrich(security), cancellationToken).ConfigureAwait(false);
        _cache[instrument.Key] = instrument;
        return instrument;
    }

    public bool Invalidate(bool force = false)
    {
        var today = TodayMoscow();
        lock (_freshGate)
        {
            if (!force && _lastInvalidationDay == today)
            {
                return false;
            }

            _stale = true;
            _lastInvalidationDay = today;
            return true;
        }
    }

    public void MarkFresh()
    {
        lock (_freshGate)
        {
            _stale = false;
        }
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

    /// <summary>
    /// Внутренний flush miss-буфера по порогу (из pump через Observe→FlushPending на trade
    /// или явный вызов). Публичный Observe копит; порог сбрасывает <see cref="TryFlushMissThresholdAsync"/>.
    /// </summary>
    public async Task TryFlushMissThresholdAsync(CancellationToken cancellationToken)
    {
        List<SecurityInfo>? batch = null;
        lock (_missGate)
        {
            if (_missBuffer.Count < MissBatchSize)
            {
                return;
            }

            batch = _missBuffer;
            _missBuffer = new List<SecurityInfo>(MissBatchSize);
        }

        await PersistMissBatchAsync(batch, cancellationToken).ConfigureAwait(false);
    }

    private async Task PersistMissBatchAsync(List<SecurityInfo> batch, CancellationToken cancellationToken)
    {
        if (batch.Count == 0)
        {
            return;
        }

        // Дедуп по ключу (последний выигрывает) — TRANSAQ может повторять secid.
        var dedup = new Dictionary<InstrumentKey, SecurityInfo>();
        foreach (var item in batch)
        {
            dedup[item.Key] = item;
        }

        var list = dedup.Values.ToList();
        var saved = await store.UpsertBatchAsync(list, cancellationToken).ConfigureAwait(false);
        foreach (var instrument in saved)
        {
            _cache[instrument.Key] = instrument;
        }
    }

    private void EnqueuePersist(SecurityInfo security) => persistQueue.Enqueue(security);

    private DateOnly TodayMoscow()
    {
        var utc = time.GetUtcNow();
        var msk = utc.ToOffset(MoexSchedule.MoscowOffset);
        return DateOnly.FromDateTime(msk.DateTime);
    }

    /// <summary>Дополняет справку атрибутами дериватива, выведенными из кода (FORTS).</summary>
    private SecurityInfo Enrich(SecurityInfo security)
    {
        if (security.UnderlyingCode is not null
            || !derivativeParser.TryParse(security.Key, security.SecType, security.ShortName,
                   DateOnly.FromDateTime(DateTime.UtcNow), out var spec))
        {
            return security;
        }

        return security with
        {
            UnderlyingCode = spec.UnderlyingCode,
            UnderlyingFuturesCode = spec.UnderlyingFuturesCode,
            UnderlyingShortName = spec.UnderlyingShortName,
            Expiration = spec.Expiration,
            OptionType = spec.OptionType,
            Strike = spec.Strike
        };
    }
}
