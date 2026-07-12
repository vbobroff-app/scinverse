using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// ВРЕМЕННО (dev): логин/пароль Transaq из appsettings.Local.json.
/// Удалить вместе с сидированием в Program и эндпоинтом transaq-local-defaults.
/// </summary>
internal static class DevLocalTransaqCredentials
{
    public static ConnectorCredentials? TryCreate(TransaqConnectorOptions options)
    {
        if (string.IsNullOrWhiteSpace(options.Login) || string.IsNullOrWhiteSpace(options.Password))
        {
            return null;
        }

        return new ConnectorCredentials(options.Login.Trim(), options.Password);
    }

    public static async Task SeedInMemoryStoreAsync(
        IServiceProvider services, ILogger logger, CancellationToken cancellationToken)
    {
        var options = services.GetRequiredService<TransaqConnectorOptions>();
        var creds = TryCreate(options);
        if (creds is null)
        {
            return;
        }

        var connectionStore = services.GetRequiredService<IConnectionStore>();
        var credentialStore = services.GetRequiredService<ICredentialStore>();
        var connections = await connectionStore.ListAsync(cancellationToken).ConfigureAwait(false);
        var count = 0;
        foreach (var connection in connections)
        {
            if (connection.Kind != "transaq")
            {
                continue;
            }

            credentialStore.Set(connection.ConnectionId, creds);
            count++;
        }

        if (count > 0)
        {
            logger.LogInformation(
                "Dev: креды Transaq из appsettings.Local.json загружены для {Count} подключений",
                count);
        }
    }
}
