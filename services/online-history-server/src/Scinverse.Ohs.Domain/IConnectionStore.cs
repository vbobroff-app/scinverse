namespace Scinverse.Ohs.Domain;

/// <summary>Хранилище подключений коннекторов (connector_connection). Без секретов.</summary>
public interface IConnectionStore
{
    Task<IReadOnlyList<ConnectorConnection>> ListAsync(CancellationToken cancellationToken);

    Task<ConnectorConnection?> GetAsync(long connectionId, CancellationToken cancellationToken);

    /// <summary>Создаёт/обновляет подключение по уникальному имени. Возвращает актуальную строку.</summary>
    Task<ConnectorConnection> UpsertAsync(
        short sourceId, string name, string kind, string settings, bool enabled, CancellationToken cancellationToken);

    Task SetEnabledAsync(long connectionId, bool enabled, CancellationToken cancellationToken);
}
