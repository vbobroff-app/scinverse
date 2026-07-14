namespace Scinverse.Ohs.Domain;

/// <summary>Политика автозаписи инструмента (phase 7i): Auto on/off + провайдер для Supervisor.</summary>
public sealed record RecordingScheduleEntry
{
    public required long InstrumentId { get; init; }
    public required long ConnectionId { get; init; }
    public required bool AutoEnabled { get; init; }
}
