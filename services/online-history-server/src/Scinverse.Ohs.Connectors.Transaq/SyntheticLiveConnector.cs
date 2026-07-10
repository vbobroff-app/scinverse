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
                _messages.Writer.TryWrite(BuildSecurities(instrument));
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

    private static string BuildSecurities(InstrumentKey key) =>
        new StringBuilder("<securities>")
            .Append("<security secid=\"1\">")
            .Append("<seccode>").Append(key.Ticker).Append("</seccode>")
            .Append("<board>").Append(key.Board).Append("</board>")
            .Append("<market>1</market>")
            .Append("<shortname>").Append(key.Ticker).Append("</shortname>")
            .Append("<decimals>2</decimals>")
            .Append("<minstep>0.01</minstep>")
            .Append("<lotsize>10</lotsize>")
            .Append("<point_cost>1</point_cost>")
            .Append("<sectype>SHARE</sectype>")
            .Append("</security>")
            .Append("</securities>")
            .ToString();
}
