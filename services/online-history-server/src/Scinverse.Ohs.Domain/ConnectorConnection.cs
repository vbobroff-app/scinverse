namespace Scinverse.Ohs.Domain;

/// <summary>
/// Подключение коннектора (connector_connection). Секретов не содержит:
/// <see cref="Settings"/> — только несекретные параметры (host/port/dllPath/timeouts) как JSON.
/// </summary>
public sealed record ConnectorConnection
{
    public required long ConnectionId { get; init; }
    public required short SourceId { get; init; }
    public required string Name { get; init; }
    public required string Kind { get; init; }
    public required string Settings { get; init; }
    public required bool Enabled { get; init; }
}
