using System.Text.Json;

namespace Scinverse.Ohs.Connectors.Transaq;

/// <inheritdoc />
public sealed class ConnectorFactory : IConnectorFactory
{
    public IMarketConnector Create(string kind, JsonElement settings, ConnectorCredentials? credentials) =>
        kind switch
        {
            "transaq" => CreateTransaq(settings, credentials),
            "synthetic" => new SyntheticLiveConnector(),
            _ => throw new ArgumentException($"Неизвестный тип коннектора '{kind}'", nameof(kind))
        };

    private static TransaqConnector CreateTransaq(JsonElement settings, ConnectorCredentials? credentials)
    {
        if (credentials is null)
        {
            throw new InvalidOperationException("Для подключения 'transaq' не заданы учётные данные (login/password)");
        }

        var options = new TransaqConnectorOptions
        {
            Login = credentials.Login,
            Password = credentials.Password,
            Host = GetString(settings, "host") ?? string.Empty,
            Port = GetInt(settings, "port") ?? 0,
            DllPath = GetString(settings, "dllPath") ?? "txmlconnector.dll",
            LogDir = GetString(settings, "logDir") ?? "logs/transaq",
            LogLevel = GetInt(settings, "logLevel") ?? 2,
            ConnectTimeoutSeconds = GetInt(settings, "connectTimeoutSeconds") ?? 30
        };

        return new TransaqConnector(options);
    }

    private static string? GetString(JsonElement settings, string name) =>
        settings.ValueKind == JsonValueKind.Object
        && settings.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static int? GetInt(JsonElement settings, string name)
    {
        if (settings.ValueKind != JsonValueKind.Object || !settings.TryGetProperty(name, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt32(out var number) => number,
            JsonValueKind.String when int.TryParse(value.GetString(), out var parsed) => parsed,
            _ => null
        };
    }
}
