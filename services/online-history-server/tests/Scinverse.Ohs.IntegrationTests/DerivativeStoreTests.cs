using Dapper;
using FluentAssertions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Storage.Timescale;

namespace Scinverse.Ohs.IntegrationTests;

/// <summary>
/// Наполнение подтип-таблицы <c>derivative</c> при upsert FUT/OPT и группировка каталога
/// (уровни underlying/series + лист цепочки). Коды — синтетический FORTS-набор phase6c.
/// </summary>
public sealed class DerivativeStoreTests : IClassFixture<TimescaleFixture>
{
    private static readonly DateOnly AsOf = new(2026, 7, 1);
    private static readonly DateOnly SeriesExpiration = new(2026, 9, 18);

    private readonly TimescaleFixture _fixture;
    private readonly InstrumentStore _store;
    private readonly MoexFortsSpecParser _parser = new();

    public DerivativeStoreTests(TimescaleFixture fixture)
    {
        _fixture = fixture;
        _store = new InstrumentStore(fixture.DataSource);
    }

    [Fact]
    public async Task Upsert_And_Group_DerivativeChain()
    {
        // Фьючерс первым — чтобы у опционов резолвился underlying_id.
        var future = await UpsertAsync("SiU6", "FUT", "FUT");
        await UpsertAsync("SiU6C65000", "OPT", "OPT");
        await UpsertAsync("SiU6P65000", "OPT", "OPT");
        await UpsertAsync("SiU6C70000", "OPT", "OPT");

        // Опцион ссылается на фьючерс через underlying_id.
        await using var connection = await _fixture.DataSource.OpenConnectionAsync();
        var underlyingId = await connection.ExecuteScalarAsync<long?>(
            "SELECT underlying_id FROM derivative d JOIN instrument i USING (instrument_id) WHERE i.ticker = 'SiU6C65000';");
        underlyingId.Should().Be(future.InstrumentId);

        var callStrike = await connection.ExecuteScalarAsync<decimal?>(
            "SELECT strike FROM derivative d JOIN instrument i USING (instrument_id) WHERE i.ticker = 'SiU6C70000';");
        callStrike.Should().Be(70000m);

        // Уровень underlying: одна группа Si на все 4 контракта.
        var underlyings = await _store.QueryGroupsAsync(new GroupQuery { Level = "underlying" }, CancellationToken.None);
        underlyings.Should().ContainSingle(g => g.Key == "Si").Which.Count.Should().Be(4);

        // Уровень series: одна серия (общая экспирация).
        var series = await _store.QueryGroupsAsync(
            new GroupQuery { Level = "series", UnderlyingCode = "Si" }, CancellationToken.None);
        series.Should().ContainSingle();
        series[0].Expiration.Should().Be(SeriesExpiration);
        series[0].Count.Should().Be(4);

        // Лист цепочки: только опционы Si.
        var options = await _store.QueryAsync(
            new InstrumentQuery { UnderlyingCode = "Si", SecType = "OPT" }, CancellationToken.None);
        options.Total.Should().Be(3);
        options.Items.Should().OnlyContain(i => i.OptionType == 'C' || i.OptionType == 'P');
    }

    private async Task<Instrument> UpsertAsync(string ticker, string board, string secType)
    {
        var key = new InstrumentKey(ticker, board);
        var security = new SecurityInfo { Key = key, MinStep = 1m, Decimals = 0, SecType = secType };

        if (_parser.TryParse(key, secType, AsOf, out var spec))
        {
            security = security with
            {
                UnderlyingCode = spec.UnderlyingCode,
                UnderlyingFuturesCode = spec.UnderlyingFuturesCode,
                Expiration = spec.Expiration,
                OptionType = spec.OptionType,
                Strike = spec.Strike
            };
        }

        return await _store.UpsertAsync(security, CancellationToken.None);
    }
}
