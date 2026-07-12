namespace Scinverse.Ohs.Domain;

/// <summary>
/// Живость захвата (honest background, phase 7h): компактные интервалы «связь жива» на подключение
/// (source). Хартбит продлевает открытый интервал; обрыв/стоп закрывает; восстановление открывает новый.
/// Зазор между интервалами = реальная дыра захвата (в т.ч. из-за падения хоста — <c>to_ts</c> замирает).
/// </summary>
public interface ICaptureLivenessStore
{
    /// <summary>
    /// Открывает или продлевает открытый интервал источника до <paramref name="ts"/>. Если разрыв с
    /// предыдущим хартбитом больше <paramref name="maxGap"/> (пропущенные тики = неявный обрыв) — закрывает
    /// старый интервал (<see cref="CaptureCloseReason.Interrupted"/>) и открывает новый (дыра остаётся честной).
    /// </summary>
    Task HeartbeatAsync(short sourceId, DateTimeOffset ts, TimeSpan maxGap, CancellationToken cancellationToken);

    /// <summary>
    /// Закрывает открытый интервал источника с причиной (обрыв/стоп). Если <paramref name="atTs"/> задан
    /// (точное время события, напр. <c>server_status=false</c>) — <c>to_ts</c> сдвигается на него
    /// (не назад); иначе остаётся на последнем хартбите. <c>to_ts</c> закрытого = начало разрыва.
    /// </summary>
    Task CloseAsync(short sourceId, CaptureCloseReason reason, DateTimeOffset? atTs, CancellationToken cancellationToken);

    /// <summary>Интервалы живости источников, пересекающие окно [from, to] (для подложки Ганта).</summary>
    Task<IReadOnlyList<LivenessInterval>> QueryAsync(
        IReadOnlyCollection<short> sourceIds, DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken);

    /// <summary>
    /// Журнал разрывов: негативное пространство между интервалами, пересекающее окно [from, to]. Причина —
    /// <c>close_reason</c> предшествующего интервала; намеренные остановки (<see cref="CaptureCloseReason.Stopped"/>)
    /// разрывами НЕ считаются. <see cref="CaptureGap.To"/> == null → разрыв ещё длится (связи так и нет).
    /// </summary>
    Task<IReadOnlyList<CaptureGap>> QueryGapsAsync(
        IReadOnlyCollection<short> sourceIds, DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken);

    /// <summary>
    /// Recovery на старте хоста: закрывает все открытые интервалы (прошлый процесс мог упасть) причиной
    /// <see cref="CaptureCloseReason.Interrupted"/>. <c>to_ts</c> остаётся на последнем хартбите. Возвращает
    /// число закрытых интервалов.
    /// </summary>
    Task<int> RecoverOpenIntervalsAsync(CancellationToken cancellationToken);
}

/// <summary>Причина закрытия интервала живости (тоньше, чем статус сегмента). Драйвит журнал разрывов.</summary>
public enum CaptureCloseReason
{
    /// <summary>Пользователь остановил запись — намеренно, НЕ разрыв.</summary>
    Stopped,

    /// <summary><c>server_status=false/error</c> — обрыв связи (точное время события).</summary>
    ServerDown,

    /// <summary>Тишина в сессии + активный пинг не прошёл — «тихая смерть» коннектора/DLL.</summary>
    PingFailed,

    /// <summary>Краш хоста / пропуск тиков — закрыто recovery на старте или split'ом хартбита.</summary>
    Interrupted,
}

/// <summary>Интервал живости захвата: [From, To], <see cref="Open"/> = ещё продлевается (живой хвост).</summary>
public sealed record LivenessInterval
{
    public required short SourceId { get; init; }
    public required DateTimeOffset From { get; init; }
    public required DateTimeOffset To { get; init; }
    public required bool Open { get; init; }

    /// <summary>Причина закрытия; null пока <see cref="Open"/>.</summary>
    public CaptureCloseReason? CloseReason { get; init; }
}

/// <summary>
/// Разрыв захвата (производное от <see cref="LivenessInterval"/>, не хранится): [From, To) между
/// соседними интервалами. <see cref="To"/> == null → разрыв ещё длится.
/// </summary>
public sealed record CaptureGap
{
    public required short SourceId { get; init; }
    public required DateTimeOffset From { get; init; }
    public DateTimeOffset? To { get; init; }
    public required CaptureCloseReason Cause { get; init; }
}
