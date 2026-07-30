namespace Scinverse.Ohs.Host;

/// <summary>
/// Слой T (crash-dispatch): транспорт admin↔OHS. Corr/seed по-прежнему считает
/// <see cref="HostOutageCoordinator"/>; в NC Group T сейчас <b>не</b> пишем —
/// дублировал C-Incident («снова доступен» между local Single и crash).
/// Слот оставлен для будущих общих system-уведомлений (не этот crash-стек).
/// </summary>
public sealed class HostOutageTransportEmitter
{
    public const string Module = "ohs.host";
    public const string CodeReachable = "host.reachable";
    public const string OpenMessage = "Пропала связь с сервером";
    public const string CloseMessage = "Сервер OHS снова доступен";

    /// <summary>No-op: дедуп POST и слой C без транспортного Group в ленте.</summary>
    public void Apply(HostOutageReportResult result)
    {
        _ = result;
    }
}
