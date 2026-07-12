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
    /// старый интервал и открывает новый (дыра остаётся честной).
    /// </summary>
    Task HeartbeatAsync(short sourceId, DateTimeOffset ts, TimeSpan maxGap, CancellationToken cancellationToken);

    /// <summary>Закрывает открытый интервал источника (обрыв/стоп). <c>to_ts</c> = последний хартбит.</summary>
    Task CloseAsync(short sourceId, CancellationToken cancellationToken);

    /// <summary>Интервалы живости источников, пересекающие окно [from, to] (для подложки Ганта).</summary>
    Task<IReadOnlyList<LivenessInterval>> QueryAsync(
        IReadOnlyCollection<short> sourceIds, DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken);

    /// <summary>
    /// Recovery на старте хоста: закрывает все открытые интервалы (прошлый процесс мог упасть). <c>to_ts</c>
    /// остаётся на последнем хартбите. Возвращает число закрытых интервалов.
    /// </summary>
    Task<int> RecoverOpenIntervalsAsync(CancellationToken cancellationToken);
}

/// <summary>Интервал живости захвата: [From, To], <see cref="Open"/> = ещё продлевается (живой хвост).</summary>
public sealed record LivenessInterval
{
    public required short SourceId { get; init; }
    public required DateTimeOffset From { get; init; }
    public required DateTimeOffset To { get; init; }
    public required bool Open { get; init; }
}
