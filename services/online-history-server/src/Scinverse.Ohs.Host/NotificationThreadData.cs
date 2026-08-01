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

    /// <summary>Команда оператора перед system <c>incident_closed</c> (фильтр sourceType=user).</summary>
    public const string CodeIncidentForceClosed = "connection.incident_force_closed";

    /// <summary>
    /// User·info «принудительно закрыл» — до system·warning <c>incident_closed</c> (тот же corr).
    /// При равном ts проекция ставит info раньше warning.
    /// </summary>
    public static void PublishOperatorForceClose(
        INotificationPublisher notifications,
        string correlationId,
        string? subject,
        DateTimeOffset at,
        long? connectionId,
        string? closeNote,
        string? resolvedBy = null)
    {
        ArgumentNullException.ThrowIfNull(notifications);
        if (string.IsNullOrWhiteSpace(correlationId))
        {
            throw new ArgumentException("correlationId is required.", nameof(correlationId));
        }

        notifications.Publish(
            CodeIncidentForceClosed,
            "Пользователь принудительно закрыл инцидент",
            severity: "info",
            sourceType: "user",
            data: new
            {
                connectionId,
                closeNote,
                resolvedBy,
                closeOutcome = OutcomeAbandonedManual,
                sender = "user",
            },
            correlationId: correlationId,
            subject: subject,
            ts: at);
    }

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

    /// <summary>
    /// Коды, которые без hint открывают Incident. <c>connect_failed</c> — нет: это провал попытки
    /// (Group <c>connect:</c> или Append в open break), не новый break.
    /// </summary>
    public static bool IsOpenCode(string code) =>
        code is "connection.lost" or "backend.unavailable" or "connection.auto_error";

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
                || string.Equals(reason, "manual_off", StringComparison.OrdinalIgnoreCase)
                || string.Equals(reason, "abandoned_manual", StringComparison.OrdinalIgnoreCase))
            {
                return OutcomeAbandonedManual;
            }

            // Hydrate only: historical client/POST with reason=schedule_end (live path removed in P4).
            if (string.Equals(reason, "schedule_end", StringComparison.OrdinalIgnoreCase)
                || string.Equals(reason, "abandoned_schedule", StringComparison.OrdinalIgnoreCase))
            {
                return OutcomeAbandonedSchedule;
            }

            return null;
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
