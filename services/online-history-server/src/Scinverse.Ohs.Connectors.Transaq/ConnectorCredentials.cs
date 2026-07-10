namespace Scinverse.Ohs.Connectors.Transaq;

/// <summary>Учётные данные подключения. Не персистятся — живут только в памяти сессии.</summary>
public sealed record ConnectorCredentials(string Login, string Password);

/// <summary>In-memory хранилище кредов подключений (по connectionId). Секреты в БД не попадают.</summary>
public interface ICredentialStore
{
    void Set(long connectionId, ConnectorCredentials credentials);

    bool TryGet(long connectionId, out ConnectorCredentials credentials);

    void Clear(long connectionId);
}
