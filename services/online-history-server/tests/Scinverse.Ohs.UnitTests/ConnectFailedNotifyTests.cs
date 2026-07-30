using System.Text.Json;
using FluentAssertions;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Host;

namespace Scinverse.Ohs.UnitTests;

public sealed class ConnectFailedNotifyTests
{
    [Fact]
    public void FormatConnected_json_result_without_lines()
    {
        var previous = new LinkInterval
        {
            SourceId = 1,
            From = new DateTimeOffset(2026, 7, 26, 0, 38, 0, TimeSpan.Zero),
            To = new DateTimeOffset(2026, 7, 26, 1, 0, 0, TimeSpan.Zero),
            Open = false,
            CloseReason = LinkCloseReason.ServerDown,
        };
        var data = ConnectionManager.FormatConnectedNotificationData(3, previous, sender: "backend");
        var el = JsonSerializer.SerializeToElement(data);
        el.GetProperty("connectionId").GetInt64().Should().Be(3);
        el.GetProperty("sender").GetString().Should().Be("backend");
        el.GetProperty("result").GetString().Should().Be(
            "Предыдущее подключение — 26.07.2026 03:38 МСК; Пред. сеанс — обрыв связи");
        el.TryGetProperty("lines", out _).Should().BeFalse();
    }

    [Fact]
    public void FormatConnectFailed_short_headline_detail_in_error_message()
    {
        var (message, data) = ConnectionManager.FormatConnectFailedNotification(
            3, "Подключение 3", "TRANSAQ connect failed: connection error");

        message.Should().Be("Подключение 3: не удалось подключиться — TRANSAQ connect failed");
        var el = JsonSerializer.SerializeToElement(data);
        el.GetProperty("connectionId").GetInt64().Should().Be(3);
        el.GetProperty("state").GetString().Should().Be("Error");
        el.GetProperty("error_message").GetString().Should().Be("connection error");
        el.GetProperty("sender").GetString().Should().Be("transaq");
    }

    [Fact]
    public void FormatConnectFailed_non_transaq_puts_full_text_in_error_message()
    {
        var (message, data) = ConnectionManager.FormatConnectFailedNotification(
            3, "Подключение 3", "Подключение 3 не найдено");

        message.Should().Be("Подключение 3: не удалось подключиться");
        var el = JsonSerializer.SerializeToElement(data);
        el.GetProperty("error_message").GetString().Should().Be("Подключение 3 не найдено");
        el.GetProperty("sender").GetString().Should().Be("backend");
    }
}
