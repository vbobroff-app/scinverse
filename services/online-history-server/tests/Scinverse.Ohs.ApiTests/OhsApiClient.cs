using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using Scinverse.Ohs.Contracts;

namespace Scinverse.Ohs.ApiTests;

/// <summary>
/// Рукописная типизированная реализация <see cref="IOhsApi"/> поверх <see cref="HttpClient"/>.
/// Заменяет source-generator Refit (несовместим с генератором-хостом Visual Studio),
/// сохраняя единый контракт между сервером и тестами. Сериализация — web-defaults (camelCase).
/// </summary>
public sealed class OhsApiClient(HttpClient http) : IOhsApi
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<InstrumentPageDto> GetInstrumentsAsync(
        InstrumentQueryParams query, CancellationToken cancellationToken = default)
    {
        var page = await http.GetFromJsonAsync<InstrumentPageDto>(
            $"/api/instruments{BuildInstrumentsQuery(query)}", Json, cancellationToken);
        return page ?? new InstrumentPageDto([], 0, query.Limit, query.Offset);
    }

    public Task<IReadOnlyList<InstrumentGroupDto>> GetInstrumentGroupsAsync(
        string level, long? underlyingId = null, CancellationToken cancellationToken = default)
    {
        var parts = new List<string> { $"level={Uri.EscapeDataString(level)}" };
        if (underlyingId is { } id)
        {
            parts.Add($"underlyingId={id}");
        }

        return GetListAsync<InstrumentGroupDto>("/api/instruments/groups?" + string.Join('&', parts), cancellationToken);
    }

    public Task<IReadOnlyList<SourceDto>> GetSourcesAsync(CancellationToken cancellationToken = default) =>
        GetListAsync<SourceDto>("/api/sources", cancellationToken);

    public Task<IReadOnlyList<SessionDto>> GetSessionsAsync(
        int count, bool includeWeekends, CancellationToken cancellationToken = default) =>
        GetListAsync<SessionDto>(
            $"/api/sessions?count={count}&includeWeekends={(includeWeekends ? "true" : "false")}", cancellationToken);

    public async Task<CoverageExtentDto> GetCoverageExtentAsync(
        short? sourceId = null, CancellationToken cancellationToken = default)
    {
        var uri = sourceId is { } id ? $"/api/coverage/extent?sourceId={id}" : "/api/coverage/extent";
        var extent = await http.GetFromJsonAsync<CoverageExtentDto>(uri, Json, cancellationToken);
        return extent ?? new CoverageExtentDto(null, null);
    }

    public Task<IReadOnlyList<CoverageSegmentDto>> GetCoverageAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken = default) =>
        GetListAsync<CoverageSegmentDto>(
            $"/api/coverage?from={Encode(from)}&to={Encode(to)}", cancellationToken);

    public Task<IReadOnlyList<RecordingDto>> GetRecordingsAsync(CancellationToken cancellationToken = default) =>
        GetListAsync<RecordingDto>("/api/recordings", cancellationToken);

    public Task<RecordingDto> StartRecordingAsync(
        StartRecordingRequest request, CancellationToken cancellationToken = default) =>
        PostAsync<StartRecordingRequest, RecordingDto>("/api/recordings", request, cancellationToken);

    public async Task StopRecordingAsync(long instrumentId, CancellationToken cancellationToken = default)
    {
        using var response = await http.DeleteAsync($"/api/recordings/{instrumentId}", cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    public Task<IReadOnlyList<ConnectionDto>> GetConnectionsAsync(CancellationToken cancellationToken = default) =>
        GetListAsync<ConnectionDto>("/api/connections", cancellationToken);

    public Task<ConnectionDto> UpsertConnectionAsync(
        UpsertConnectionRequest request, CancellationToken cancellationToken = default) =>
        PostAsync<UpsertConnectionRequest, ConnectionDto>("/api/connections", request, cancellationToken);

    public async Task SetCredentialsAsync(
        long id, ConnectionCredentialsRequest request, CancellationToken cancellationToken = default)
    {
        using var response = await http.PutAsJsonAsync(
            $"/api/connections/{id}/credentials", request, Json, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    public Task<ConnectionDto> ConnectConnectionAsync(long id, CancellationToken cancellationToken = default) =>
        PostAsync<ConnectionDto>($"/api/connections/{id}/connect", cancellationToken);

    public Task<ConnectionDto> DisconnectConnectionAsync(long id, CancellationToken cancellationToken = default) =>
        PostAsync<ConnectionDto>($"/api/connections/{id}/disconnect", cancellationToken);

    public Task<ConnectionDto> TestConnectionAsync(long id, CancellationToken cancellationToken = default) =>
        PostAsync<ConnectionDto>($"/api/connections/{id}/test", cancellationToken);

    private async Task<IReadOnlyList<T>> GetListAsync<T>(string uri, CancellationToken cancellationToken)
    {
        var result = await http.GetFromJsonAsync<List<T>>(uri, Json, cancellationToken);
        return result ?? [];
    }

    private async Task<TResponse> PostAsync<TRequest, TResponse>(
        string uri, TRequest body, CancellationToken cancellationToken)
    {
        using var response = await http.PostAsJsonAsync(uri, body, Json, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await ReadAsync<TResponse>(response, cancellationToken);
    }

    private async Task<TResponse> PostAsync<TResponse>(string uri, CancellationToken cancellationToken)
    {
        using var response = await http.PostAsync(uri, content: null, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await ReadAsync<TResponse>(response, cancellationToken);
    }

    private static async Task<TResponse> ReadAsync<TResponse>(
        HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var result = await response.Content.ReadFromJsonAsync<TResponse>(Json, cancellationToken);
        return result ?? throw new InvalidOperationException(
            $"Пустой ответ при десериализации в {typeof(TResponse).Name}");
    }

    private static string Encode(DateTimeOffset value) =>
        Uri.EscapeDataString(value.ToString("O", CultureInfo.InvariantCulture));

    private static string BuildInstrumentsQuery(InstrumentQueryParams query)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            parts.Add($"q={Uri.EscapeDataString(query.Q)}");
        }

        if (!string.IsNullOrWhiteSpace(query.Board))
        {
            parts.Add($"board={Uri.EscapeDataString(query.Board)}");
        }

        if (!string.IsNullOrWhiteSpace(query.SecType))
        {
            parts.Add($"secType={Uri.EscapeDataString(query.SecType)}");
        }

        if (!string.IsNullOrWhiteSpace(query.Category))
        {
            parts.Add($"category={Uri.EscapeDataString(query.Category)}");
        }

        if (query.OnlyRecording)
        {
            parts.Add("onlyRecording=true");
        }

        if (query.NonEmpty)
        {
            parts.Add("nonEmpty=true");
        }

        if (query.InstrumentIds is { Count: > 0 } instrumentIds)
        {
            parts.Add($"instrumentIds={Uri.EscapeDataString(string.Join(',', instrumentIds))}");
        }

        if (query.Exchanges is { Count: > 0 } exchanges)
        {
            parts.Add($"exchanges={Uri.EscapeDataString(string.Join(',', exchanges))}");
        }

        if (query.UnderlyingId is { } underlyingId)
        {
            parts.Add($"underlyingId={underlyingId}");
        }

        if (query.Expiration is { } expiration)
        {
            parts.Add($"expiration={expiration:yyyy-MM-dd}");
        }

        parts.Add($"limit={query.Limit}");
        parts.Add($"offset={query.Offset}");
        return "?" + string.Join('&', parts);
    }
}
