using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Host;

namespace Scinverse.Ohs.UnitTests;

public sealed class BasketEvalServiceTests
{
    private static BasketEvalService Create(params AvailableInstrument[] available)
    {
        var instruments = new FakeInstrumentStore();
        foreach (var a in available)
        {
            var inst = instruments.UpsertAsync(
                new SecurityInfo
                {
                    Key = new InstrumentKey(a.Ticker, a.Board),
                    MinStep = 1m,
                    SecType = a.SecType,
                },
                CancellationToken.None).GetAwaiter().GetResult();
            // Upsert задаёт новый id — для Match используем переданный available as-is.
            _ = inst;
        }

        return new BasketEvalService(
            instruments,
            new EmptyBasketStore(),
            new EmptyConnectionStoreForLifecycle(),
            NullLogger<BasketEvalService>.Instance);
    }

    [Fact]
    public void Match_glob_and_sec_type_filter()
    {
        var available = new AvailableInstrument[]
        {
            new(1, "Si-9.26", "FUT", "FUT"),
            new(2, "Si-12.26", "FUT", "FUT"),
            new(3, "SBER", "TQBR", "SHARE"),
            new(4, "RTS-3.27", "FUT", "FUT"),
        };

        var svc = Create(available);
        var matched = svc.Match(
            new BasketRule { Patterns = ["Si-*.*"], SecType = "FUT" },
            available);

        matched.Select(m => m.Ticker).Should().Equal("Si-12.26", "Si-9.26");
    }

    [Fact]
    public void Match_empty_patterns_yields_empty()
    {
        var available = new[] { new AvailableInstrument(1, "Si-9.26", "FUT", "FUT") };
        var svc = Create(available);
        svc.Match(new BasketRule { Patterns = [] }, available).Should().BeEmpty();
    }

}
