namespace Scinverse.Ohs.Domain;

/// <summary>
/// Сегмент записи (сессия) — «колбаска» на Ганте покрытия.
/// <see cref="EndedAt"/> == null означает активную запись.
/// </summary>
public sealed record CoverageSegment
{
    public required long SegmentId { get; init; }
    public required long InstrumentId { get; init; }
    public required short SourceId { get; init; }
    public required DateTimeOffset StartedAt { get; init; }
    public DateTimeOffset? EndedAt { get; init; }
    public required long TradeCount { get; init; }
    public required string Status { get; init; }
}
