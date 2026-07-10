using FluentAssertions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.UnitTests;

public sealed class TradeNormalizerTests
{
    private static readonly InstrumentKey Sber = new("SBER", "TQBR");

    private static async Task<TradeNormalizer> BuildNormalizerAsync(params Instrument[] instruments)
    {
        var registry = new InstrumentRegistry(new FakeInstrumentStore(instruments), new MoexFortsSpecParser());
        await registry.InitializeAsync(CancellationToken.None);
        return new TradeNormalizer(registry);
    }

    [Fact]
    public async Task TryNormalize_KnownInstrument_ConvertsPriceToTicks()
    {
        var normalizer = await BuildNormalizerAsync(new Instrument
        {
            InstrumentId = 7,
            Key = Sber,
            MinStep = 0.01m
        });

        var trade = new TradeEvent
        {
            Key = Sber,
            TradeNo = 42,
            Timestamp = DateTimeOffset.UnixEpoch,
            Price = 250.13m,
            Quantity = 5,
            Side = MarketSide.Buy
        };

        normalizer.TryNormalize(trade, sourceId: 1, out var record).Should().BeTrue();
        record!.InstrumentId.Should().Be(7);
        record.SourceId.Should().Be(1);
        record.PriceTicks.Should().Be(25013);
        record.Quantity.Should().Be(5);
        record.Side.Should().Be(MarketSide.Buy);
    }

    [Fact]
    public async Task TryNormalize_UnknownInstrument_ReturnsFalse()
    {
        var normalizer = await BuildNormalizerAsync();

        var trade = new TradeEvent
        {
            Key = Sber,
            TradeNo = 1,
            Timestamp = DateTimeOffset.UnixEpoch,
            Price = 100m,
            Quantity = 1,
            Side = MarketSide.Sell
        };

        normalizer.TryNormalize(trade, sourceId: 1, out var record).Should().BeFalse();
        record.Should().BeNull();
    }
}
