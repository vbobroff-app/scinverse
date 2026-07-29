using System.Diagnostics.CodeAnalysis;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Scinverse.Ohs.Contracts;
using Scinverse.Ohs.Domain;

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

    [Fact]
    public async Task Connect_and_disconnect_emit_user_notifications()
    {
        var api = CreateApi();
        var http = factory.CreateClient();
        var synthetic = (await api.GetConnectionsAsync()).First(c => c.Kind == "synthetic");

        await api.ConnectConnectionAsync(synthetic.ConnectionId);
        await api.DisconnectConnectionAsync(synthetic.ConnectionId);

        // Publish синхронен: к моменту ответа эндпоинта события уже в ring-buffer.
        var notes = await GetNotificationsAsync(http);

        // Команда оператора — дискретное user-событие (info), отдельной строкой.
        notes.Should().Contain(
            n => n.Code == "connection.connect" && n.SourceType == "user" && n.Severity == "info",
            "команда connect оператора — user-событие в ленте (крит. #1)");

        // Исполнение системой как группа: connecting(warning/underway) + connected(ok/resolved) одним correlationId.
        var connecting = notes.LastOrDefault(
            n => n.Code == "connection.connecting" && n.SourceType == "system"
                 && n.Severity == "warning" && n.Status == "underway");
        connecting.Should().NotBeNull("старт установки связи — сигнал «подключаюсь» (жёлтый, system)");
        var connected = notes.LastOrDefault(
            n => n.Code == "connection.connected" && n.SourceType == "system"
                 && n.Severity == "ok" && n.Status == "resolved");
        connected.Should().NotBeNull("успех — «связь установлена» (зелёный/resolved, system)");
        connected!.CorrelationId.Should().Be(connecting!.CorrelationId, "одна попытка connect — одна группа");
        connecting.CorrelationId.Should().StartWith($"connection:{synthetic.ConnectionId}:connect:");

        notes.Should().Contain(
            n => n.Code == "connection.disconnect" && n.SourceType == "user" && n.Severity == "info",
            "ручной disconnect — user-событие в ленте (крит. #1)");
    }

    [Fact]
    public async Task DebugDrop_emits_link_incident_lifecycle_notifications()
    {
        var api = CreateApi();
        var client = new OhsApiClient(factory.CreateClient());
        var http = factory.CreateClient();
        var synthetic = (await api.GetConnectionsAsync()).First(c => c.Kind == "synthetic");
        await api.ConnectConnectionAsync(synthetic.ConnectionId);

        try
        {
            (await client.DebugDropAsync(synthetic.ConnectionId, seconds: 1)).Should().BeTrue();
            (await PollConnectionStatusAsync(synthetic.ConnectionId, "disconnected", TimeSpan.FromSeconds(5)))
                .Should().BeTrue();
            (await PollConnectionStatusAsync(
                synthetic.ConnectionId, s => s is "waiting" or "active" or "degraded", TimeSpan.FromSeconds(10)))
                .Should().BeTrue();

            var subject = $"connection:{synthetic.ConnectionId}:link";
            var recovered = await PollNotificationAsync(
                http, n => n.Code == "connection.recovered" && n.Status == "resolved", TimeSpan.FromSeconds(5));
            recovered.Should().NotBeNull("восстановление связи закрывает инцидент (resolved)");
            recovered!.CorrelationId.Should().StartWith(subject + ":", "инцидент — per-occurrence subject:uid");

            var notes = await GetNotificationsAsync(http);
            notes.Should().Contain(
                n => n.Code == "connection.lost" && n.Severity == "error" && n.Status == "active",
                "обрыв открывает инцидент (active, error)");
        }
        finally
        {
            await api.DisconnectConnectionAsync(synthetic.ConnectionId);
        }
    }

    [Fact]
    public async Task Disconnect_while_link_down_emits_abandoned_manual()
    {
        var api = CreateApi();
        var client = new OhsApiClient(factory.CreateClient());
        var http = factory.CreateClient();
        var synthetic = (await api.GetConnectionsAsync()).First(c => c.Kind == "synthetic");
        await api.ConnectConnectionAsync(synthetic.ConnectionId);

        (await client.DebugDropAsync(synthetic.ConnectionId, seconds: 30)).Should().BeTrue();
        (await PollConnectionStatusAsync(synthetic.ConnectionId, "disconnected", TimeSpan.FromSeconds(5)))
            .Should().BeTrue("обрыв должен открыть break до recover");

        // Пока synthetic ещё down — disconnect закрывает break как abandoned_manual (J11b / I11).
        await api.DisconnectConnectionAsync(synthetic.ConnectionId);

        var closed = await PollNotificationAsync(
            http,
            n => n.Code == "connection.incident_closed" && n.Status == "resolved",
            TimeSpan.FromSeconds(5));
        closed.Should().NotBeNull("ручной off при open break пишет incident_closed");
        closed!.Severity.Should().Be("warning");
        closed.CorrelationId.Should().StartWith($"connection:{synthetic.ConnectionId}:link:");
        NotificationDataString(closed, "closeOutcome").Should().Be("abandoned_manual");
        NotificationDataString(closed, "reason").Should().Be("manual_off");

        var notes = await GetNotificationsAsync(http);
        notes.Should().Contain(
            n => n.Code == "connection.disconnect" && n.SourceType == "user",
            "команда оператора остаётся отдельным user-событием");
        notes.Should().NotContain(
            n => n.Code == "connection.recovered" && n.CorrelationId == closed.CorrelationId,
            "не должны успеть закрыть тот же corr как recovered");
    }

    [Fact]
    public async Task Incidents_api_lists_filters_and_returns_detail_with_duration()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IIncidentStore>();
        var t0 = new DateTimeOffset(2026, 7, 29, 8, 0, 0, TimeSpan.Zero);
        var t1 = t0.AddMinutes(5);
        const string corrA = "connection:41:link:api11c01";
        const string corrB = "connection:42:link:api11c02";

        await store.OpenAsync(
            new Incident
            {
                CorrUid = corrA,
                Module = "connection",
                Type = "break",
                Status = "active",
                OpenedAt = t0,
                Subject = "connection:41:link",
                Severity = "error",
                Title = "a",
                LastActivityAt = t0,
                ConnectionId = 41,
                SourceId = 1,
                Subtype = "down",
                Owner = "supervisor",
            },
            CancellationToken.None);
        await store.OpenAsync(
            new Incident
            {
                CorrUid = corrB,
                Module = "connection",
                Type = "break",
                Status = "active",
                OpenedAt = t0.AddHours(1),
                Subject = "connection:42:link",
                Severity = "error",
                Title = "b",
                LastActivityAt = t0.AddHours(1),
                ConnectionId = 42,
                SourceId = 1,
                Subtype = "degraded",
                Owner = "transaq",
            },
            CancellationToken.None);
        await store.ResolveAsync(
            corrA, t1, "recovered", title: null, severity: "ok", resolvedBy: null, CancellationToken.None);

        var api = CreateApi();
        var all = await api.GetIncidentsAsync(new IncidentQueryParams { Module = "connection", Limit = 50 });
        all.Should().Contain(i => i.CorrUid == corrA);
        all.Should().Contain(i => i.CorrUid == corrB);

        var filtered = await api.GetIncidentsAsync(new IncidentQueryParams
        {
            ConnectionId = 41,
            Status = "resolved",
        });
        filtered.Should().ContainSingle(i => i.CorrUid == corrA);
        filtered[0].CloseOutcome.Should().Be("recovered");
        filtered[0].DurationMs.Should().Be((long)TimeSpan.FromMinutes(5).TotalMilliseconds);

        var detail = await api.GetIncidentAsync(corrA);
        detail.Should().NotBeNull();
        detail!.Status.Should().Be("resolved");
        detail.DurationMs.Should().Be(filtered[0].DurationMs);

        var window = await api.GetConnectionIncidentsAsync(
            41, from: t0.AddMinutes(-1), to: t1.AddMinutes(1));
        window.Should().ContainSingle(i => i.CorrUid == corrA);

        (await api.GetIncidentAsync("connection:0:link:missing")).Should().BeNull();
    }

    [Fact]
    public async Task Resolve_incident_marks_abandoned_manual_with_resolvedBy()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IIncidentStore>();
        // opened_at в прошлом: CHECK closed_at >= opened_at (TimeProvider = UtcNow).
        var t0 = DateTimeOffset.UtcNow.AddHours(-1);
        const string corr = "connection:55:link:manual01";
        await store.OpenAsync(
            new Incident
            {
                CorrUid = corr,
                Module = "connection",
                Type = "break",
                Status = "active",
                OpenedAt = t0,
                Subject = "connection:55:link",
                Severity = "error",
                Title = "manual close me",
                LastActivityAt = t0,
                ConnectionId = 55,
                SourceId = 1,
                Subtype = "down",
                Owner = "supervisor",
            },
            CancellationToken.None);

        var api = CreateApi();
        var closed = await api.ResolveIncidentAsync(corr, new ResolveIncidentRequest("operator-a"));
        closed.Status.Should().Be("resolved");
        closed.CloseOutcome.Should().Be("abandoned_manual");
        closed.ResolvedBy.Should().Be("operator-a");

        var again = await api.ResolveIncidentAsync(corr, new ResolveIncidentRequest("operator-b"));
        again.Status.Should().Be("resolved");
        again.ResolvedBy.Should().Be("operator-b");
    }

    private static async Task<IReadOnlyList<NotificationRow>> GetNotificationsAsync(HttpClient http)
    {
        var rows = await http.GetFromJsonAsync<List<NotificationRow>>(
            "/api/notifications", new JsonSerializerOptions(JsonSerializerDefaults.Web));
        return rows ?? [];
    }

    private static async Task<NotificationRow?> PollNotificationAsync(
        HttpClient http, Func<NotificationRow, bool> predicate, TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource(timeout);
        while (!cts.Token.IsCancellationRequested)
        {
            var match = (await GetNotificationsAsync(http)).FirstOrDefault(predicate);
            if (match is not null)
            {
                return match;
            }

            await Task.Delay(200, cts.Token);
        }

        return null;
    }

    private static string? NotificationDataString(NotificationRow row, string key)
    {
        if (row.Data is not { } data || data.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return data.TryGetProperty(key, out var p) && p.ValueKind == JsonValueKind.String
            ? p.GetString()
            : null;
    }

    private sealed record NotificationRow(
        string Code,
        string Severity,
        string SourceType,
        string? Status,
        string? CorrelationId,
        JsonElement? Data);

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
