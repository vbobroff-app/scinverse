namespace Scinverse.Ohs.Domain;

/// <summary>Хранилище подключений коннекторов (connector_connection). Без секретов.</summary>
public interface IConnectionStore
{
    Task<IReadOnlyList<ConnectorConnection>> ListAsync(CancellationToken cancellationToken);

    Task<ConnectorConnection?> GetAsync(long connectionId, CancellationToken cancellationToken);

    /// <summary>Создаёт/обновляет подключение по уникальному имени. Возвращает актуальную строку.</summary>
    Task<ConnectorConnection> UpsertAsync(
        short sourceId, string name, string kind, string settings, bool enabled, CancellationToken cancellationToken);

    /// <summary>Обновляет подключение по id (в т.ч. переименование). Возвращает строку или null, если не найдено.</summary>
    Task<ConnectorConnection?> UpdateAsync(
        long connectionId, short sourceId, string name, string kind, string settings, bool enabled, CancellationToken cancellationToken);

    /// <summary>Удаляет подключение по id. Возвращает true, если строка была удалена.</summary>
    Task<bool> DeleteAsync(long connectionId, CancellationToken cancellationToken);

    Task SetEnabledAsync(long connectionId, bool enabled, CancellationToken cancellationToken);
}
