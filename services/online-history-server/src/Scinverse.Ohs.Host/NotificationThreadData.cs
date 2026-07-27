using System.Text.Json;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Поля <c>notification.data</c> (jsonb) для проекции Thread / Incident / Group (phase 11.11).
/// Таблицы/колонки не меняем — хватает существующего <c>data</c> (to-threads §6.0).
/// </summary>
public static class NotificationThreadData
{
    public const string KindIncident = "incident";
    public const string KindGroup = "group";
    public const string OutcomeRecovered = "recovered";
    public const string OutcomeAbandonedSchedule = "abandoned_schedule";
    public const string OutcomeAbandonedManual = "abandoned_manual";

    /// <summary>Дописать hint/outcome, не затирая уже заданные ключи.</summary>
    public static object? WithHints(
        object? data,
        string? threadKindHint = null,
        string? closeOutcome = null)
    {
        if (threadKindHint is null && closeOutcome is null)
        {
            return data;
        }

        var map = ToMap(data);
        if (threadKindHint is not null && !map.ContainsKey("threadKindHint"))
        {
            map["threadKindHint"] = threadKindHint;
        }

        if (closeOutcome is not null && !map.ContainsKey("closeOutcome"))
        {
            map["closeOutcome"] = closeOutcome;
        }

        return map;
    }

    /// <summary>
    /// Эвристика по code/status, если продюсер не проставил поля.
    /// Open-коды без hint → incident (Host открывает в горизонте); close → recovered / abandoned_*.
    /// </summary>
    public static object? EnrichByCode(string code, string? status, object? data)
    {
        string? kind = null;
        string? outcome = null;

        if (string.Equals(status, "active", StringComparison.Ordinal) && IsOpenCode(code))
        {
            kind = KindIncident;
        }

        if (string.Equals(status, "resolved", StringComparison.Ordinal))
        {
            outcome = InferCloseOutcome(code, data);
        }

        return WithHints(data, kind, outcome);
    }

    /// <summary>То же для Ingest (клиентский JsonElement).</summary>
    public static JsonElement? EnrichJson(string code, string? status, JsonElement? data)
    {
        object? asObj = null;
        if (data is { } el && el.ValueKind == JsonValueKind.Object)
        {
            asObj = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(el.GetRawText());
        }

        var enriched = EnrichByCode(code, status, asObj);
        if (enriched is null)
        {
            return data;
        }

        return JsonSerializer.SerializeToElement(enriched);
    }

    public static bool IsOpenCode(string code) =>
        code is "connection.lost" or "backend.unavailable"
            or "connection.auto_error" or "connection.connect_failed";

    public static string? InferCloseOutcome(string code, object? data)
    {
        if (code is "connection.recovered" or "backend.recovered")
        {
            return OutcomeRecovered;
        }

        if (code == "connection.incident_closed")
        {
            if (TryGetString(data, "closeOutcome") is { } existing)
            {
                return existing;
            }

            var reason = TryGetString(data, "reason");
            if (string.Equals(reason, "manual", StringComparison.OrdinalIgnoreCase)
                || string.Equals(reason, "abandoned_manual", StringComparison.OrdinalIgnoreCase))
            {
                return OutcomeAbandonedManual;
            }

            return OutcomeAbandonedSchedule;
        }

        return null;
    }

    private static Dictionary<string, object?> ToMap(object? data)
    {
        if (data is null)
        {
            return new Dictionary<string, object?>(StringComparer.Ordinal);
        }

        if (data is Dictionary<string, object?> dict)
        {
            return new Dictionary<string, object?>(dict, StringComparer.Ordinal);
        }

        if (data is Dictionary<string, JsonElement> jsonDict)
        {
            var mapped = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (var (k, v) in jsonDict)
            {
                mapped[k] = JsonSerializer.Deserialize<object>(v.GetRawText());
            }

            return mapped;
        }

        using var doc = JsonSerializer.SerializeToDocument(data);
        var result = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (doc.RootElement.ValueKind != JsonValueKind.Object)
        {
            return result;
        }

        foreach (var prop in doc.RootElement.EnumerateObject())
        {
            result[prop.Name] = JsonSerializer.Deserialize<object>(prop.Value.GetRawText());
        }

        return result;
    }

    private static string? TryGetString(object? data, string key)
    {
        if (data is null)
        {
            return null;
        }

        var map = ToMap(data);
        if (!map.TryGetValue(key, out var value) || value is null)
        {
            return null;
        }

        return value switch
        {
            string s => s,
            JsonElement { ValueKind: JsonValueKind.String } je => je.GetString(),
            _ => value.ToString(),
        };
    }
}
