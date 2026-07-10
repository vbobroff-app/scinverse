using System.Text.Json;

namespace Scinverse.Ohs.Connectors.Transaq;

/// <summary>Создаёт коннектор по типу подключения (connector_connection.kind) и его настройкам.</summary>
public interface IConnectorFactory
{
    /// <param name="kind">'transaq' / 'synthetic'.</param>
    /// <param name="settings">Несекретные параметры (host/port/dllPath/…), JSONB из БД.</param>
    /// <param name="credentials">Креды из in-memory (для 'transaq'); для 'synthetic' — null.</param>
    IMarketConnector Create(string kind, JsonElement settings, ConnectorCredentials? credentials);
}
