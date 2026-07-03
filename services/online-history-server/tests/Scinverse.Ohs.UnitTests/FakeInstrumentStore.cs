using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

/// <summary>In-memory реализация порта справочника для юнит-тестов.</summary>
internal sealed class FakeInstrumentStore : IInstrumentStore
{
    private readonly List<Instrument> _instruments;
    private long _nextId;

    public FakeInstrumentStore(params Instrument[] instruments)
    {
        _instruments = [.. instruments];
        _nextId = _instruments.Count + 1;
    }

    public Task<IReadOnlyList<Instrument>> LoadAllAsync(CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<Instrument>>(_instruments);

    public Task<Instrument> UpsertAsync(SecurityInfo security, CancellationToken cancellationToken)
    {
        var existing = _instruments.FirstOrDefault(i => i.Key == security.Key);
        var instrument = new Instrument
        {
            InstrumentId = existing?.InstrumentId ?? _nextId++,
            Key = security.Key,
            MinStep = security.MinStep,
            Decimals = security.Decimals,
            LotSize = security.LotSize
        };

        _instruments.RemoveAll(i => i.Key == security.Key);
        _instruments.Add(instrument);
        return Task.FromResult(instrument);
    }
}
