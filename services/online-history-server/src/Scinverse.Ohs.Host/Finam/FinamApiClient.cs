using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Caching.Memory;
using Scinverse.Ohs.Domain.Finam;

namespace Scinverse.Ohs.Host.Finam;

/// <summary>
/// Finam Trade API поверх typed <see cref="HttpClient"/>. Секрет <c>tapi_sk_…</c> обменивается на JWT
/// (<c>POST /v1/sessions</c>), который кэшируется в памяти (~14 мин, TTL токена 15) и подставляется в
/// заголовок <c>Authorization</c>. MVP-поверхность — auth (health-check) + расписание инструмента.
/// </summary>
public sealed class FinamApiClient(HttpClient http, IMemoryCache cache, ILogger<FinamApiClient> logger)
    : IFinamApi
{
    private static readonly TimeSpan TokenTtl = TimeSpan.FromMinutes(14);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<string> AuthenticateAsync(string secret, CancellationToken cancellationToken)
    {
        using var response = await http.PostAsJsonAsync(
            "/v1/sessions", new AuthRequest(secret), Json, cancellationToken).ConfigureAwait(false);

        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Finam auth {(int)response.StatusCode}: {ExtractError(body)}");
        }

        var token = JsonSerializer.Deserialize<AuthResponse>(body, Json)?.Token;
        if (string.IsNullOrWhiteSpace(token))
        {
            throw new InvalidOperationException("Finam auth: пустой токен в ответе");
        }

        return token;
    }

    public async Task<FinamSchedule> GetScheduleAsync(string secret, string symbol, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(symbol))
        {
            throw new ArgumentException("Не задан символ инструмента", nameof(symbol));
        }

        var dto = await SendWithTokenAsync(
            secret,
            token => new HttpRequestMessage(HttpMethod.Get, $"/v1/assets/{Uri.EscapeDataString(symbol)}/schedule")
            {
                Headers = { { "Authorization", token } },
            },
            cancellationToken).ConfigureAwait(false);

        var sessions = (dto.Sessions ?? [])
            .Where(s => s.Interval is { StartTime: not null, EndTime: not null })
            .Select(s => new FinamSession(
                s.Type ?? "UNKNOWN",
                s.Interval!.StartTime!.Value,
                s.Interval.EndTime!.Value))
            .ToList();

        logger.LogDebug("Finam schedule {Symbol}: {Count} sessions", symbol, sessions.Count);
        return new FinamSchedule(dto.Symbol ?? symbol, sessions);
    }

    /// <summary>Выполняет запрос с JWT из кэша; при 401 сбрасывает кэш и повторяет один раз.</summary>
    private async Task<ScheduleResponse> SendWithTokenAsync(
        string secret, Func<string, HttpRequestMessage> build, CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var token = await GetTokenAsync(secret, forceRefresh: attempt > 0, cancellationToken).ConfigureAwait(false);
            using var request = build(token);
            using var response = await http.SendAsync(request, cancellationToken).ConfigureAwait(false);

            if (response.StatusCode == HttpStatusCode.Unauthorized && attempt == 0)
            {
                cache.Remove(TokenKey(secret));
                continue;
            }

            var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                throw new InvalidOperationException($"Finam {(int)response.StatusCode}: {ExtractError(body)}");
            }

            return JsonSerializer.Deserialize<ScheduleResponse>(body, Json)
                ?? new ScheduleResponse(null, null);
        }

        throw new InvalidOperationException("Finam: не удалось выполнить запрос после обновления токена");
    }

    private async Task<string> GetTokenAsync(string secret, bool forceRefresh, CancellationToken cancellationToken)
    {
        var key = TokenKey(secret);
        if (!forceRefresh && cache.TryGetValue<string>(key, out var cached) && !string.IsNullOrEmpty(cached))
        {
            return cached;
        }

        var token = await AuthenticateAsync(secret, cancellationToken).ConfigureAwait(false);
        cache.Set(key, token, TokenTtl);
        return token;
    }

    private static string TokenKey(string secret) => $"finam-jwt:{secret.GetHashCode()}";

    /// <summary>Достаёт человекочитаемое <c>message</c> из тела ошибки Finam, иначе — сырое тело.</summary>
    private static string ExtractError(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            return "нет тела ответа";
        }

        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("message", out var message))
            {
                return message.GetString() ?? body;
            }
        }
        catch (JsonException)
        {
            // не JSON — вернём как есть
        }

        return body.Length > 200 ? body[..200] : body;
    }

    private sealed record AuthRequest(string Secret);

    private sealed record AuthResponse([property: JsonPropertyName("token")] string? Token);

    private sealed record ScheduleResponse(
        [property: JsonPropertyName("symbol")] string? Symbol,
        [property: JsonPropertyName("sessions")] IReadOnlyList<SessionDto>? Sessions);

    private sealed record SessionDto(
        [property: JsonPropertyName("type")] string? Type,
        [property: JsonPropertyName("interval")] IntervalDto? Interval);

    private sealed record IntervalDto(
        [property: JsonPropertyName("start_time")] DateTimeOffset? StartTime,
        [property: JsonPropertyName("end_time")] DateTimeOffset? EndTime);
}
