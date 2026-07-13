using System.Diagnostics.CodeAnalysis;
using System.Net.WebSockets;
using System.Text;
using FluentAssertions;
using Scinverse.Ohs.Contracts;

namespace Scinverse.Ohs.ApiTests;

public sealed class OhsApiTests(OhsApiFactory factory) : IClassFixture<OhsApiFactory>
{
    // Возврат интерфейса намеренный: тесты работают против контракта IOhsApi, а не реализации.
    [SuppressMessage("Performance", "CA1859:Use concrete types when possible", Justification = "Тесты завязаны на контракт IOhsApi.")]
    private IOhsApi CreateApi() => new OhsApiClient(factory.CreateClient());

    [Fact]
    public async Task Reference_endpoints_return_seeded_data()
    {
        var api = CreateApi();

        var instruments = await api.GetInstrumentsAsync(new InstrumentQueryParams { Q = "SBER" });
        instruments.Items.Should().Contain(i => i.Ticker == "SBER" && i.Board == "TQBR");

        var sources = await api.GetSourcesAsync();
        sources.Should().Contain(s => s.Code == "synthetic");

        var connections = await api.GetConnectionsAsync();
        connections.Should().Contain(c => c.Kind == "synthetic");
        connections.Should().OnlyContain(c => !c.Settings.Contains("password", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Instruments_support_search_and_paging()
    {
        var api = CreateApi();

        var found = await api.GetInstrumentsAsync(new InstrumentQueryParams { Q = "SBER", Limit = 10 });
        found.Items.Should().Contain(i => i.Ticker == "SBER");
        found.Total.Should().BeGreaterThan(0);
        found.Limit.Should().Be(10);

        var empty = await api.GetInstrumentsAsync(new InstrumentQueryParams { Q = "NO_SUCH_TICKER_ZZZ" });
        empty.Items.Should().BeEmpty();
        empty.Total.Should().Be(0);
    }

    [Fact]
    public async Task Instruments_filter_by_ids_and_exchange()
    {
        var api = CreateApi();

        // «Выделенные»: только явные instrument_id.
        var byId = await api.GetInstrumentsAsync(new InstrumentQueryParams
        {
            InstrumentIds = [factory.SberInstrumentId]
        });
        byId.Items.Should().OnlyContain(i => i.InstrumentId == factory.SberInstrumentId);
        byId.Items.Should().Contain(i => i.Ticker == "SBER");

        // «Биржи» MOEX — no-op (все борды MOEX): SBER остаётся в выборке.
        var moex = await api.GetInstrumentsAsync(new InstrumentQueryParams
        {
            Q = "SBER",
            Exchanges = ["MOEX"]
        });
        moex.Items.Should().Contain(i => i.Ticker == "SBER");

        // Неизвестная биржа — пустая выборка (не-MOEX бордов ещё нет).
        var bogus = await api.GetInstrumentsAsync(new InstrumentQueryParams
        {
            Exchanges = ["NASDAQ"]
        });
        bogus.Items.Should().BeEmpty();
        bogus.Total.Should().Be(0);
    }

    [Fact]
    public async Task Futures_expose_option_series_and_strikes()
    {
        var api = CreateApi();

        // Верхний уровень «Фьючерсы»: GZU6 помечен HasOptions и опционы в список не попадают.
        var futures = await api.GetInstrumentsAsync(new InstrumentQueryParams { Category = "futures", Q = "GZU6" });
        var gz = futures.Items.Should().ContainSingle(i => i.Ticker == "GZU6").Subject;
        gz.HasOptions.Should().BeTrue();
        futures.Items.Should().NotContain(i => i.SecType == "OPT");

        // Раскрытие фьючерса → серии опционов (по экспирации).
        var series = await api.GetInstrumentGroupsAsync("series", underlyingId: gz.InstrumentId);
        series.Should().ContainSingle().Which.Expiration.Should().NotBeNull();

        // Раскрытие серии → страйки (только опционы).
        var chain = await api.GetInstrumentsAsync(new InstrumentQueryParams { UnderlyingId = gz.InstrumentId, SecType = "OPT" });
        chain.Items.Should().OnlyContain(i => i.OptionType == "C" || i.OptionType == "P");
        chain.Total.Should().Be(2);
    }

    [Fact]
    public async Task Recording_lifecycle_opens_and_closes_coverage()
    {
        var api = CreateApi();
        var synthetic = (await api.GetConnectionsAsync()).First(c => c.Kind == "synthetic");

        var connected = await api.ConnectConnectionAsync(synthetic.ConnectionId);
        connected.Status.Should().Be("waiting");

        var recording = await api.StartRecordingAsync(
            new StartRecordingRequest(factory.SberInstrumentId, synthetic.ConnectionId));
        recording.SegmentId.Should().BeGreaterThan(0);

        try
        {
            var tradeCount = await PollAsync(async () =>
            {
                var recordings = await api.GetRecordingsAsync();
                return recordings.FirstOrDefault(r => r.InstrumentId == factory.SberInstrumentId)?.TradeCount ?? 0;
            });
            tradeCount.Should().BeGreaterThan(0, "synthetic-коннектор стримит сделки");
        }
        finally
        {
            await api.StopRecordingAsync(factory.SberInstrumentId);
        }

        var now = DateTimeOffset.UtcNow;
        var coverage = await api.GetCoverageAsync(now.AddHours(-1), now.AddHours(1));
        var segment = coverage.First(s => s.InstrumentId == factory.SberInstrumentId);
        segment.To.Should().NotBeNull("после остановки сегмент закрыт");
        segment.TradeCount.Should().BeGreaterThan(0);

        // Фильтр «Не пустые»: SBER записывался, поэтому попадает в выборку по nonEmpty.
        var nonEmpty = await api.GetInstrumentsAsync(new InstrumentQueryParams { NonEmpty = true, Q = "SBER" });
        nonEmpty.Items.Should().Contain(i => i.Ticker == "SBER");
    }

    [Fact]
    public async Task DebugDrop_synthetic_emits_connection_state_events()
    {
        var api = CreateApi();
        var client = new OhsApiClient(factory.CreateClient());
        var synthetic = (await api.GetConnectionsAsync()).First(c => c.Kind == "synthetic");
        await api.ConnectConnectionAsync(synthetic.ConnectionId);

        try
        {
            (await client.DebugDropAsync(synthetic.ConnectionId, seconds: 1)).Should().BeTrue();

            var sawDown = await PollConnectionStatusAsync(synthetic.ConnectionId, "disconnected", TimeSpan.FromSeconds(5));
            sawDown.Should().BeTrue("обрыв должен перевести подключение в disconnected");

            var sawLive = await PollConnectionStatusAsync(
                synthetic.ConnectionId, s => s is "waiting" or "active" or "degraded", TimeSpan.FromSeconds(10));
            sawLive.Should().BeTrue("после recover связь должна восстановиться");
        }
        finally
        {
            await api.DisconnectConnectionAsync(synthetic.ConnectionId);
        }
    }

    [Fact]
    public async Task Connect_after_debug_drop_reconnects()
    {
        var api = CreateApi();
        var client = new OhsApiClient(factory.CreateClient());
        var synthetic = (await api.GetConnectionsAsync()).First(c => c.Kind == "synthetic");

        await api.ConnectConnectionAsync(synthetic.ConnectionId);
        (await client.DebugDropAsync(synthetic.ConnectionId, seconds: 30)).Should().BeTrue();
        var sawDown = await PollConnectionStatusAsync(synthetic.ConnectionId, "disconnected", TimeSpan.FromSeconds(5));
        sawDown.Should().BeTrue();

        var reconnected = await api.ConnectConnectionAsync(synthetic.ConnectionId);
        reconnected.Status.Should().Be("waiting", "повторный connect после Down должен поднять сессию заново");

        await api.DisconnectConnectionAsync(synthetic.ConnectionId);
    }

    private async Task<bool> PollConnectionStatusAsync(
        long connectionId, string expected, TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource(timeout);
        while (!cts.Token.IsCancellationRequested)
        {
            var api = new OhsApiClient(factory.CreateClient());
            var row = (await api.GetConnectionsAsync(cts.Token))
                .FirstOrDefault(c => c.ConnectionId == connectionId);
            if (row?.Status == expected)
            {
                return true;
            }

            await Task.Delay(200, cts.Token);
        }

        return false;
    }

    private async Task<bool> PollConnectionStatusAsync(
        long connectionId, Func<string, bool> predicate, TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource(timeout);
        while (!cts.Token.IsCancellationRequested)
        {
            var api = new OhsApiClient(factory.CreateClient());
            var row = (await api.GetConnectionsAsync(cts.Token))
                .FirstOrDefault(c => c.ConnectionId == connectionId);
            if (row is not null && predicate(row.Status))
            {
                return true;
            }

            await Task.Delay(200, cts.Token);
        }

        return false;
    }

    [Fact]
    public async Task WebSocket_pushes_coverage_extended_event()
    {
        var api = CreateApi();
        var synthetic = (await api.GetConnectionsAsync()).First(c => c.Kind == "synthetic");
        await api.ConnectConnectionAsync(synthetic.ConnectionId);

        var wsClient = factory.Server.CreateWebSocketClient();
        var socket = await wsClient.ConnectAsync(new Uri(factory.Server.BaseAddress, "ws"), CancellationToken.None);

        try
        {
            await api.StartRecordingAsync(new StartRecordingRequest(factory.SberInstrumentId, synthetic.ConnectionId));
            var received = await ReadUntilAsync(socket, "coverageExtended", TimeSpan.FromSeconds(20));
            received.Should().BeTrue("heartbeat покрытия шлёт coverageExtended");
        }
        finally
        {
            await api.StopRecordingAsync(factory.SberInstrumentId);
            await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
        }
    }

    private static async Task<long> PollAsync(Func<Task<long>> probe)
    {
        for (var attempt = 0; attempt < 30; attempt++)
        {
            var value = await probe();
            if (value > 0)
            {
                return value;
            }

            await Task.Delay(500);
        }

        return 0;
    }

    private static async Task<bool> ReadUntilAsync(WebSocket socket, string marker, TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource(timeout);
        var buffer = new byte[8192];
        try
        {
            while (socket.State == WebSocketState.Open)
            {
                var result = await socket.ReceiveAsync(buffer, cts.Token);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    return false;
                }

                var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
                if (text.Contains(marker, StringComparison.Ordinal))
                {
                    return true;
                }
            }
        }
        catch (OperationCanceledException)
        {
            return false;
        }

        return false;
    }
}
