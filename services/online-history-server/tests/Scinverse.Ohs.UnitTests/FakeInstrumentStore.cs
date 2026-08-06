using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

/// <summary>In-memory реализация порта справочника для юнит-тестов.</summary>
internal sealed class FakeInstrumentStore : IInstrumentStore
{
    private readonly List<Instrument> _instruments;
    private readonly Dictionary<long, DateOnly?> _expirations = new();
    private readonly Dictionary<long, string?> _secTypes = new();
    private readonly Dictionary<long, string?> _shortNames = new();
    private long _nextId;

    public FakeInstrumentStore(params Instrument[] instruments)
    {
        _instruments = [.. instruments];
        _nextId = _instruments.Count + 1;
    }

    public Task<IReadOnlyList<Instrument>> LoadAllAsync(CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<Instrument>>(_instruments.Where(i => i.Active).ToList());

    public Task<IReadOnlyList<Instrument>> LoadByIdsAsync(
        IReadOnlyList<long> instrumentIds, CancellationToken cancellationToken)
    {
        var set = instrumentIds.ToHashSet();
        var list = _instruments.Where(i => i.Active && set.Contains(i.InstrumentId)).ToList();
        return Task.FromResult<IReadOnlyList<Instrument>>(list);
    }

    public Task<IReadOnlyList<AvailableInstrument>> ListAvailableAsync(CancellationToken cancellationToken)
    {
        var list = _instruments
            .Where(i => i.Active)
            .Select(i => new AvailableInstrument(
                i.InstrumentId,
                i.Key.Ticker,
                i.Key.Board,
                _secTypes.GetValueOrDefault(i.InstrumentId),
                _shortNames.GetValueOrDefault(i.InstrumentId)))
            .ToList();
        return Task.FromResult<IReadOnlyList<AvailableInstrument>>(list);
    }

    public Task<InstrumentCatalogPage> QueryAsync(InstrumentQuery query, CancellationToken cancellationToken)
    {
        var items = _instruments
            .Where(i => i.Active)
            .Select(i => new InstrumentCatalogItem
            {
                InstrumentId = i.InstrumentId,
                Ticker = i.Key.Ticker,
                Board = i.Key.Board,
                MinStep = i.MinStep,
                Decimals = i.Decimals,
                Active = i.Active
            })
            .ToList();

        return Task.FromResult(new InstrumentCatalogPage(items, items.Count, query.Limit, query.Offset));
    }

    public Task<IReadOnlyList<InstrumentGroup>> QueryGroupsAsync(GroupQuery query, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<InstrumentGroup>>([]);

    public Task<IReadOnlyList<SecurityInfo>> LoadDerivativeCandidatesAsync(CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<SecurityInfo>>([]);

    public Task<Instrument> UpsertAsync(SecurityInfo security, CancellationToken cancellationToken)
    {
        var instrument = UpsertCore(security);
        return Task.FromResult(instrument);
    }

    public Task<IReadOnlyList<Instrument>> UpsertBatchAsync(
        IReadOnlyList<SecurityInfo> securities, CancellationToken cancellationToken)
    {
        var result = new List<Instrument>(securities.Count);
        foreach (var security in securities)
        {
            result.Add(UpsertCore(security));
        }

        return Task.FromResult<IReadOnlyList<Instrument>>(result);
    }

    private Instrument UpsertCore(SecurityInfo security)
    {
        var today = InstrumentLifecycle.TodayMoscow(TimeProvider.System);
        var existing = _instruments.FirstOrDefault(i => i.Key == security.Key);
        var instrument = new Instrument
        {
            InstrumentId = existing?.InstrumentId ?? _nextId++,
            Key = security.Key,
            MinStep = security.MinStep,
            Decimals = security.Decimals,
            LotSize = security.LotSize,
            Active = InstrumentLifecycle.IsListedOnline(security.Expiration, today)
        };

        _instruments.RemoveAll(i => i.Key == security.Key);
        _instruments.Add(instrument);
        _shortNames[instrument.InstrumentId] = security.ShortName;
        _secTypes[instrument.InstrumentId] = security.SecType;
        _expirations[instrument.InstrumentId] = security.Expiration;
        return instrument;
    }

    /// <summary>Тестовый хелпер: sec_type для уже засеянного инструмента.</summary>
    public void SetSecType(long instrumentId, string? secType) =>
        _secTypes[instrumentId] = secType;

    public Task<InstrumentScopeInfo?> GetScopeInfoAsync(long instrumentId, CancellationToken cancellationToken)
    {
        var instrument = _instruments.FirstOrDefault(i => i.InstrumentId == instrumentId);
        return Task.FromResult<InstrumentScopeInfo?>(
            instrument is null ? null : new InstrumentScopeInfo(instrument.Key.Board, null, null));
    }

    public Task<bool> IsListedOnlineAsync(long instrumentId, CancellationToken cancellationToken)
    {
        var instrument = _instruments.FirstOrDefault(i => i.InstrumentId == instrumentId);
        if (instrument is null || !instrument.Active)
        {
            return Task.FromResult(false);
        }

        var today = InstrumentLifecycle.TodayMoscow(TimeProvider.System);
        _expirations.TryGetValue(instrumentId, out var exp);
        return Task.FromResult(InstrumentLifecycle.IsListedOnline(exp, today));
    }

    public Task<IReadOnlyList<long>> ArchiveExpiredAsync(DateOnly todayMsk, CancellationToken cancellationToken)
    {
        var archived = new List<long>();
        for (var i = 0; i < _instruments.Count; i++)
        {
            var instrument = _instruments[i];
            if (!instrument.Active)
            {
                continue;
            }

            if (!_expirations.TryGetValue(instrument.InstrumentId, out var exp) || exp is null)
            {
                continue;
            }

            if (exp.Value < todayMsk)
            {
                _instruments[i] = instrument with { Active = false };
                archived.Add(instrument.InstrumentId);
            }
        }

        return Task.FromResult<IReadOnlyList<long>>(archived);
    }

    /// <summary>Тестовый хелпер: задать expiration для уже засеянного инструмента.</summary>
    public void SetExpiration(long instrumentId, DateOnly? expiration) =>
        _expirations[instrumentId] = expiration;

    public Task<decimal?> GetLastTradePriceAsync(long instrumentId, CancellationToken cancellationToken) =>
        Task.FromResult<decimal?>(null);
}
