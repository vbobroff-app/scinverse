namespace Scinverse.Ohs.Connectors.Transaq;

/// <summary>Состояние связи с TRANSAQ (phase 7h), выведенное из <c>server_status</c>.</summary>
public enum ConnectorLinkState
{
    /// <summary><c>connected="true"</c> без recover — поток жив.</summary>
    Live,

    /// <summary><c>connected="true" recover="true"</c> — восстановление после обрыва.</summary>
    Degraded,

    /// <summary><c>connected="false"</c> — сессия разорвана.</summary>
    Down,

    /// <summary><c>connected="error"</c> — ошибка соединения.</summary>
    Error,
}

/// <summary>Смена состояния связи коннектора (публикуется в <see cref="IMarketConnector.LinkStateChanges"/>).</summary>
public sealed record ConnectorLinkStateChange(
    ConnectorLinkState State,
    DateTimeOffset At,
    string? Detail = null);
