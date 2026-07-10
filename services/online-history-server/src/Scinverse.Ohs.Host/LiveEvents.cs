namespace Scinverse.Ohs.Host;

/// <summary>Событие, публикуемое клиентам по WebSocket. Поле <c>type</c> — дискриминатор.</summary>
public abstract record LiveEvent(string Type);

public sealed record RecordingStartedEvent(long InstrumentId, short SourceId, long ConnectionId, long SegmentId)
    : LiveEvent("recordingStarted");

public sealed record RecordingStoppedEvent(long InstrumentId)
    : LiveEvent("recordingStopped");

public sealed record CoverageExtendedEvent(long InstrumentId, short SourceId, DateTimeOffset To, long TradeCount)
    : LiveEvent("coverageExtended");

public sealed record ConnectionStatusChangedEvent(long ConnectionId, string Status)
    : LiveEvent("connectionStatusChanged");
