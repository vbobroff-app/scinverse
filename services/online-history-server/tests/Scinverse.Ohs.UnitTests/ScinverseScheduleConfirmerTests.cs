using FluentAssertions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Domain.Finam;
using Scinverse.Ohs.Domain.Moex;
using Scinverse.Ohs.Domain.Schedule;
using Scinverse.Ohs.Host;
using Scinverse.Ohs.Host.Finam;

namespace Scinverse.Ohs.UnitTests;

/// <summary>
/// Роутинг композитного источника <see cref="ScinverseScheduleConfirmer"/> (adapter scinverse):
/// futures → ISS (fallback Finam); stock/currency → Finam (fallback ISS); календарь → всегда ISS.
/// </summary>
public sealed class ScinverseScheduleConfirmerTests
{
    private static readonly DateOnly Today = new(2026, 7, 20);

    private static ScinverseScheduleConfirmer Build(FakeExchangeCatalog catalog, FakeFinamApi finamApi, bool finamConfigured)
    {
        var iss = new IssScheduleConfirmer(catalog);
        var finam = new FinamScheduleConfirmer(finamApi);
        var store = new FakeExternalServiceStore(finamConfigured);
        return new ScinverseScheduleConfirmer(finam, iss, store);
    }

    [Fact]
    public async Task Futures_uses_ISS()
    {
        var catalog = new FakeExchangeCatalog { Futures = IssTrading() };
        var finamApi = new FakeFinamApi { Schedule = FinamTrading() };
        var confirmer = Build(catalog, finamApi, finamConfigured: true);

        var result = await confirmer.GetScheduleAsync(
            new ConfirmerQuery(null, "futures", Today, null), CancellationToken.None);

        result.Sessions.Should().Contain(s => s.RawType == "main_session", "futures идёт через ISS");
        finamApi.ScheduleCalls.Should().Be(0, "при непустом ISS Finam не дёргается");
    }

    [Fact]
    public async Task Stock_uses_Finam_because_ISS_empty()
    {
        var catalog = new FakeExchangeCatalog { Stock = [] }; // ISS по stock пуст (как в реале)
        var finamApi = new FakeFinamApi { Schedule = FinamTrading() };
        var confirmer = Build(catalog, finamApi, finamConfigured: true);

        var result = await confirmer.GetScheduleAsync(
            new ConfirmerQuery("SBER@MISX", "stock", Today, null), CancellationToken.None);

        result.Sessions.Should().Contain(s => s.RawType == "CORE_TRADING", "stock идёт через Finam");
        finamApi.ScheduleCalls.Should().Be(1);
    }

    [Fact]
    public async Task Futures_falls_back_to_Finam_when_ISS_empty()
    {
        var catalog = new FakeExchangeCatalog { Futures = [] }; // ISS вернул пусто
        var finamApi = new FakeFinamApi { Schedule = FinamTrading() };
        var confirmer = Build(catalog, finamApi, finamConfigured: true);

        var result = await confirmer.GetScheduleAsync(
            new ConfirmerQuery("SiU6@RTSX", "futures", Today, null), CancellationToken.None);

        result.Sessions.Should().Contain(s => s.RawType == "CORE_TRADING", "fallback futures → Finam");
    }

    [Fact]
    public async Task Returns_empty_when_no_source_available()
    {
        var catalog = new FakeExchangeCatalog { Futures = [] };
        var finamApi = new FakeFinamApi { Schedule = FinamTrading() };
        var confirmer = Build(catalog, finamApi, finamConfigured: false); // Finam не настроен

        var result = await confirmer.GetScheduleAsync(
            new ConfirmerQuery(null, "futures", Today, null), CancellationToken.None);

        result.Sessions.Should().BeEmpty("нет ни ISS, ни настроенного Finam — пустое расписание без падения");
        finamApi.ScheduleCalls.Should().Be(0, "секрет Finam недоступен — до API не доходим");
    }

    [Fact]
    public async Task Calendar_always_delegates_to_ISS()
    {
        var catalog = new FakeExchangeCatalog { Futures = IssTrading() };
        var confirmer = Build(catalog, new FakeFinamApi(), finamConfigured: true);

        var calendar = await confirmer.GetCalendarAsync("futures", Today, Today, CancellationToken.None);

        calendar.Subject.Should().Be("futures");
        catalog.CalendarCalls.Should().Be(1, "календарь берётся только у ISS");
    }

    private static IReadOnlyList<IssSessionSlot> IssTrading() =>
    [
        new("main_session", Msk(10, 0), Msk(19, 0)),
    ];

    private static FinamSchedule FinamTrading() =>
        new("SBER@MISX", [new FinamSession("CORE_TRADING", Utc(7, 0), Utc(15, 59))]);

    private static DateTimeOffset Msk(int h, int m) =>
        new(2026, 7, 20, h, m, 0, TimeSpan.FromHours(3));

    private static DateTimeOffset Utc(int h, int m) =>
        new(2026, 7, 20, h, m, 0, TimeSpan.Zero);

    private sealed class FakeFinamApi : IFinamApi
    {
        public FinamSchedule Schedule { get; init; } = new("?", []);
        public int ScheduleCalls { get; private set; }

        public Task<string> AuthenticateAsync(string secret, CancellationToken cancellationToken) =>
            Task.FromResult("jwt");

        public Task<FinamSchedule> GetScheduleAsync(string secret, string symbol, CancellationToken cancellationToken)
        {
            ScheduleCalls++;
            return Task.FromResult(Schedule with { Symbol = symbol });
        }
    }

    private sealed class FakeExchangeCatalog : IExchangeCatalog
    {
        public IReadOnlyList<IssSessionSlot> Futures { get; init; } = [];
        public IReadOnlyList<IssSessionSlot> Stock { get; init; } = [];
        public int CalendarCalls { get; private set; }

        public Task<IReadOnlyList<IssSessionSlot>> GetSessionScheduleAsync(
            string engine, CancellationToken cancellationToken) =>
            Task.FromResult(engine == "stock" ? Stock : Futures);

        public Task<EngineCalendar> GetEngineCalendarAsync(string engine, CancellationToken cancellationToken)
        {
            CalendarCalls++;
            return Task.FromResult(EngineCalendar.Build([], []));
        }

        public Task<IReadOnlyList<IssEngine>> GetEnginesAsync(CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<IssMarket>> GetMarketsAsync(string engine, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<IssBoard>> GetBoardsAsync(
            string engine, string market, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<IssSecurity>> GetBoardSecuritiesAsync(
            string engine, string market, string board, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<IssFuturesRef>> GetFortsFuturesAsync(CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<string?> ResolveContractGroupTypeAsync(string secid, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }

    private sealed class FakeExternalServiceStore(bool finamConfigured) : IExternalServiceStore
    {
        public Task<IReadOnlyList<ExternalService>> ListAsync(CancellationToken cancellationToken)
        {
            IReadOnlyList<ExternalService> list = finamConfigured
                ?
                [
                    new ExternalService
                    {
                        ServiceId = 1, Name = "Finam", Adapter = "finam", Transport = "rest",
                        HasSecret = true, Enabled = true,
                    },
                ]
                : [];
            return Task.FromResult(list);
        }

        public Task<string?> GetSecretAsync(long serviceId, CancellationToken cancellationToken) =>
            Task.FromResult<string?>(finamConfigured ? "tapi_sk_test" : null);

        public Task<ExternalService?> GetAsync(long serviceId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<ExternalService?> CreateAsync(
            string name, string adapter, string transport, string? secret, DateOnly? secretExpiresOn,
            bool enabled, CancellationToken cancellationToken) => throw new NotSupportedException();

        public Task<ExternalService?> UpdateAsync(
            long serviceId, string name, string adapter, string transport, string? secret,
            DateOnly? secretExpiresOn, bool enabled, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<bool> DeleteAsync(long serviceId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<ExternalService?> GetScheduleSourceAsync(CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<ExternalService?> SetScheduleSourceAsync(
            long serviceId, bool enabled, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }
}
