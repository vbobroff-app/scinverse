using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using System.Threading.Channels;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Connectors.Transaq;

/// <summary>
/// Демо-коннектор, который стримит сделки во времени (в отличие от одноразового
/// <see cref="FakeReplayConnector"/>): для каждого подписанного инструмента периодически
/// публикует <c>alltrades</c>-фрагменты. Даёт «живые» ползущие колбаски покрытия без TRANSAQ.
/// </summary>
public sealed class SyntheticLiveConnector : IMarketConnector
{
    private sealed class State
    {
        public required InstrumentKey Key { get; init; }
        public decimal Price = 100.00m;
        public long TradeNo;
    }

    private sealed record DemoSecurity(
        string Ticker, string Board, string SecType, string ShortName, decimal MinStep, short Decimals);

    // Демо-каталог для наполнения дерева деривативов без TRANSAQ: акции + фьючерсы с полной
    // опционной цепочкой Si-9.26 (недельные/месячные/квартальная — в реальном MOEX-формате кодов).
    // Фьючерсы идут перед опционами, чтобы у опционов резолвился underlying_id.
    private static readonly DemoSecurity[] DemoCatalog = BuildDemoCatalog();

    private static DemoSecurity[] BuildDemoCatalog()
    {
        var list = new List<DemoSecurity>
        {
            Share("SBER"),
            Share("GAZP"),
            Fut("SiU6", "Si-9.26"),   // базовый квартальный фьючерс демо-цепочки
            Fut("RIU6", "RTS-9.26"),
            Fut("BRU6", "BR-9.26")
        };
        list.AddRange(BuildSiChain());
        return [.. list];
    }

    private static DemoSecurity Share(string ticker) => new(ticker, "TQBR", "SHARE", ticker, 0.01m, 2);

    private static DemoSecurity Fut(string ticker, string shortName) =>
        new(ticker, "FUT", "FUT", shortName, 1m, 0);

    // Опционная цепочка Si-9.26 на 2026 год. 3-й четверг месяца — месячная/квартальная серия
    // (поле W пустое), прочие четверги — недельные (W = A..E). См. spec MOEX (moex.com/s205).
    private static IEnumerable<DemoSecurity> BuildSiChain()
    {
        const int year = 2026;
        int[] strikes = [80000, 85000];
        (int Day, int Month, char? Week)[] series =
        [
            (2, 7, 'A'),   // W1 июля
            (9, 7, 'B'),   // W2 июля
            (23, 7, 'D'),  // W4 июля
            (30, 7, 'E'),  // W5 июля
            (16, 7, null), // месячная июля (M7)
            (20, 8, null), // месячная августа (M8)
            (17, 9, null)  // квартальная сентября (Q3)
        ];

        foreach (var (day, month, week) in series)
        {
            foreach (var strike in strikes)
            {
                yield return BuildOption(day, month, year, week, strike, isCall: true);
                yield return BuildOption(day, month, year, week, strike, isCall: false);
            }
        }
    }

    private static DemoSecurity BuildOption(int day, int month, int year, char? week, int strike, bool isCall)
    {
        // Краткий код: Si{страйк}{тип расчётов B}{буква колл/пут+месяц}{цифра года}{неделя?}.
        var monthLetter = (char)((isCall ? 'A' : 'M') + (month - 1));
        var weekLetter = week is { } w ? w.ToString() : string.Empty;
        var ticker = $"Si{strike}B{monthLetter}{year % 10}{weekLetter}";

        // Длинный код (short_name): Si-9.26M{ddMMyy}{C|P}A{страйк}.
        var cp = isCall ? 'C' : 'P';
        var shortName = $"Si-9.26M{day:00}{month:00}{year % 100:00}{cp}A{strike}";

        return new DemoSecurity(ticker, "OPT", "OPT", shortName, 1m, 0);
    }

    private readonly TimeSpan _interval;
    private readonly int _tradesPerTick;
    private readonly Random _random = new(20260701);
    private readonly ConcurrentDictionary<InstrumentKey, State> _subscribed = new();
    private readonly Channel<string> _messages = Channel.CreateUnbounded<string>(new UnboundedChannelOptions
    {
        SingleReader = true,
        SingleWriter = false
    });

    private CancellationTokenSource? _loopCts;
    private Task? _loopTask;

    public SyntheticLiveConnector(TimeSpan? interval = null, int tradesPerTick = 5)
    {
        _interval = interval ?? TimeSpan.FromMilliseconds(500);
        _tradesPerTick = tradesPerTick;
    }

    public string SourceCode => "synthetic";

    public ChannelReader<string> Messages => _messages.Reader;

    public bool IsConnected { get; private set; }

    public Task ConnectAsync(CancellationToken cancellationToken)
    {
        IsConnected = true;

        // Регистрируем весь демо-каталог сразу при подключении: справочник + дерево деривативов
        // наполняются до первой подписки (плоский список и дерево видны без старта записи).
        _messages.Writer.TryWrite(BuildSecurities(DemoCatalog));

        _loopCts = new CancellationTokenSource();
        _loopTask = RunLoopAsync(_loopCts.Token);
        return Task.CompletedTask;
    }

    public Task SubscribeTradesAsync(IReadOnlyCollection<InstrumentKey> instruments, CancellationToken cancellationToken)
    {
        foreach (var instrument in instruments)
        {
            if (_subscribed.TryAdd(instrument, new State { Key = instrument }))
            {
                _messages.Writer.TryWrite(BuildSecurities([ToDemo(instrument)]));
            }
        }

        return Task.CompletedTask;
    }

    public Task UnsubscribeTradesAsync(IReadOnlyCollection<InstrumentKey> instruments, CancellationToken cancellationToken)
    {
        foreach (var instrument in instruments)
        {
            _subscribed.TryRemove(instrument, out _);
        }

        return Task.CompletedTask;
    }

    public async Task DisconnectAsync(CancellationToken cancellationToken)
    {
        IsConnected = false;
        if (_loopCts is not null)
        {
            await _loopCts.CancelAsync().ConfigureAwait(false);
        }

        if (_loopTask is not null)
        {
            try
            {
                await _loopTask.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Штатная остановка.
            }
        }

        _messages.Writer.TryComplete();
    }

    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync(CancellationToken.None).ConfigureAwait(false);
        _loopCts?.Dispose();
    }

    private async Task RunLoopAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(_interval);
        while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
        {
            foreach (var state in _subscribed.Values)
            {
                _messages.Writer.TryWrite(BuildTrades(state));
            }
        }
    }

    private string BuildTrades(State state)
    {
        var builder = new StringBuilder("<alltrades>");
        for (var i = 0; i < _tradesPerTick; i++)
        {
            state.Price += _random.Next(-3, 4) * 0.01m;
            if (state.Price < 1m)
            {
                state.Price = 1m;
            }

            var time = DateTime.Now.ToString("dd.MM.yyyy HH:mm:ss.fff", CultureInfo.InvariantCulture);
            var side = _random.Next(2) == 0 ? "B" : "S";

            builder
                .Append("<trade>")
                .Append("<tradeno>").Append(++state.TradeNo).Append("</tradeno>")
                .Append("<board>").Append(state.Key.Board).Append("</board>")
                .Append("<seccode>").Append(state.Key.Ticker).Append("</seccode>")
                .Append("<time>").Append(time).Append("</time>")
                .Append("<price>").Append(state.Price.ToString(CultureInfo.InvariantCulture)).Append("</price>")
                .Append("<quantity>").Append(_random.Next(1, 50)).Append("</quantity>")
                .Append("<buysell>").Append(side).Append("</buysell>")
                .Append("</trade>");
        }

        builder.Append("</alltrades>");
        return builder.ToString();
    }

    private static DemoSecurity ToDemo(InstrumentKey key) =>
        Array.Find(DemoCatalog, d => d.Ticker == key.Ticker && d.Board == key.Board)
        ?? new DemoSecurity(key.Ticker, key.Board, "SHARE", key.Ticker, 0.01m, 2);

    private static string BuildSecurities(IEnumerable<DemoSecurity> instruments)
    {
        var builder = new StringBuilder("<securities>");
        foreach (var instrument in instruments)
        {
            builder
                .Append("<security secid=\"1\">")
                .Append("<seccode>").Append(instrument.Ticker).Append("</seccode>")
                .Append("<board>").Append(instrument.Board).Append("</board>")
                .Append("<market>1</market>")
                .Append("<shortname>").Append(instrument.ShortName).Append("</shortname>")
                .Append("<decimals>").Append(instrument.Decimals).Append("</decimals>")
                .Append("<minstep>").Append(instrument.MinStep.ToString(CultureInfo.InvariantCulture)).Append("</minstep>")
                .Append("<lotsize>1</lotsize>")
                .Append("<point_cost>1</point_cost>")
                .Append("<sectype>").Append(instrument.SecType).Append("</sectype>")
                .Append("</security>");
        }

        builder.Append("</securities>");
        return builder.ToString();
    }
}
