namespace Scinverse.Ohs.Domain;

/// <summary>
/// Версия расписания соединения (phase 7j). Окно версионируется SCD-2;
/// <see cref="Mode"/> на текущей строке (<see cref="EffectiveTo"/> == null) меняется in-place.
/// </summary>
public sealed record ConnectionScheduleEntry
{
    public required long ScheduleId { get; init; }
    public required long ConnectionId { get; init; }

    /// <summary><c>manual</c> | <c>scheduled</c> (Auto off / on).</summary>
    public required string Mode { get; init; }

    public required TimeOnly WindowStart { get; init; }
    public required TimeOnly WindowEnd { get; init; }

    /// <summary>Ведущий календарь дней (ISS engine): futures | stock | currency.</summary>
    public required string Engine { get; init; }

    public required string Tz { get; init; }
    public required DateTimeOffset EffectiveFrom { get; init; }
    public DateTimeOffset? EffectiveTo { get; init; }
    public required string ChangeSource { get; init; }
    public string? ChangeNote { get; init; }

    public bool IsCurrent => EffectiveTo is null;
    public bool AutoEnabled => string.Equals(Mode, ConnectionScheduleModes.Scheduled, StringComparison.Ordinal);
}

public static class ConnectionScheduleModes
{
    public const string Manual = "manual";
    public const string Scheduled = "scheduled";
}
