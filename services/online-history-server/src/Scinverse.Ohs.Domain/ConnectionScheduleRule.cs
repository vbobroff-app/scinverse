namespace Scinverse.Ohs.Domain;

/// <summary>
/// Одно правило расписания соединения (phase 7j v2). Слоистая модель со SCD-2:
/// уровни <see cref="ConnectionScheduleScopes"/> (main/dow/date), окно = <see cref="OpenTime"/> +
/// <see cref="DurationMin"/> и принадлежит дню открытия. Разрешение — <see cref="ConnectionScheduleResolver"/>.
/// </summary>
public sealed record ConnectionScheduleRule
{
    public required long ScheduleId { get; init; }
    public required long ConnectionId { get; init; }

    /// <summary><c>main</c> | <c>dow</c> | <c>date</c>.</summary>
    public required string ScopeKind { get; init; }

    /// <summary>Битовая маска дней открытия для <c>dow</c> (Пн=1…Вс=64); иначе null.</summary>
    public int? DowMask { get; init; }

    /// <summary>Диапазон дат открытия для <c>date</c> (v2); иначе null.</summary>
    public DateOnly? DateFrom { get; init; }
    public DateOnly? DateTo { get; init; }

    /// <summary><c>window</c> (окно связи) | <c>off</c> (нерабочий период).</summary>
    public required string Mode { get; init; }

    /// <summary>Момент открытия сессии (tz-local); задан при <c>mode=window</c>.</summary>
    public TimeOnly? OpenTime { get; init; }

    /// <summary>Длительность сессии в минутах (1..1439); задан при <c>mode=window</c>.</summary>
    public int? DurationMin { get; init; }

    public required DateTimeOffset EffectiveFrom { get; init; }
    public DateTimeOffset? EffectiveTo { get; init; }

    /// <summary><c>superseded</c> | <c>canceled</c> при закрытой версии; иначе null.</summary>
    public string? CloseReason { get; init; }

    public required string ChangeSource { get; init; }
    public string? ChangeNote { get; init; }

    public bool IsLive => EffectiveTo is null;
    public bool IsWindow => string.Equals(Mode, ConnectionScheduleRuleModes.Window, StringComparison.Ordinal);
}

/// <summary>Настройки расписания уровня соединения (общие для всех правил).</summary>
public sealed record ConnectionScheduleSettings
{
    public required long ConnectionId { get; init; }
    public required bool AutoEnabled { get; init; }

    /// <summary>Ведущий календарь дней (ISS engine): futures | stock | currency.</summary>
    public required string Engine { get; init; }

    public required string Tz { get; init; }
}

/// <summary>Живое состояние расписания соединения: настройки + все живые правила.</summary>
public sealed record ConnectionScheduleState
{
    public required ConnectionScheduleSettings Settings { get; init; }
    public required IReadOnlyList<ConnectionScheduleRule> LiveRules { get; init; }
}

public static class ConnectionScheduleScopes
{
    public const string Main = "main";
    public const string Dow = "dow";
    public const string Date = "date";

    /// <summary>Приоритет уровня: date &gt; dow &gt; main.</summary>
    public static int Tier(string scopeKind) => scopeKind switch
    {
        Date => 2,
        Dow => 1,
        _ => 0,
    };
}

public static class ConnectionScheduleRuleModes
{
    public const string Window = "window";
    public const string Off = "off";
}

public static class ConnectionScheduleCloseReasons
{
    public const string Superseded = "superseded";
    public const string Canceled = "canceled";
}

/// <summary>Помощники для битовой маски дней недели (Пн=1…Вс=64).</summary>
public static class ConnectionScheduleDow
{
    public const int All = 127;
    public const int Weekdays = 1 | 2 | 4 | 8 | 16; // Пн..Пт
    public const int Weekend = 32 | 64;             // Сб,Вс

    /// <summary>Бит для конкретного дня недели.</summary>
    public static int Bit(DayOfWeek day) =>
        day == DayOfWeek.Sunday ? 64 : 1 << ((int)day - 1);

    public static bool Contains(int mask, DayOfWeek day) => (mask & Bit(day)) != 0;

    /// <summary><paramref name="inner"/> полностью вложена в <paramref name="outer"/>.</summary>
    public static bool IsSubset(int inner, int outer) => (inner & outer) == inner;
}
