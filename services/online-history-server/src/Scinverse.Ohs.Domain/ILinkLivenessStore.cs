namespace Scinverse.Ohs.Domain;

/// <summary>
/// Жизненный цикл СВЯЗИ подключения (phase 7h.8): компактные интервалы «связь жива» на подключение
/// (source), НЕЗАВИСИМО от записи. В отличие от <see cref="ICaptureLivenessStore"/> («связь жива И пишем»),
/// пишется всё время, пока подключение connected — keepalive продлевает <c>to_ts</c> открытого интервала без
/// пинга; обрыв/дисконнект закрывает с причиной; восстановление открывает новый. Питает ленту Connection и
/// проекцию «слушаю ∩ связь лежит» на инструмент.
/// </summary>
public interface ILinkLivenessStore
{
    /// <summary>
    /// Открывает или продлевает открытый интервал связи источника до <paramref name="ts"/>. Если разрыв с
    /// предыдущим keepalive больше <paramref name="maxGap"/> (пропущенные тики = неявный обрыв процесса) —
    /// закрывает старый (<see cref="LinkCloseReason.Interrupted"/>) и открывает новый (дыра остаётся честной).
    /// </summary>
    Task HeartbeatAsync(short sourceId, DateTimeOffset ts, TimeSpan maxGap, CancellationToken cancellationToken);

    /// <summary>
    /// Закрывает открытый интервал связи источника с причиной. Если <paramref name="atTs"/> задан (точное
    /// время события, напр. <c>server_status=false</c>) — <c>to_ts</c> сдвигается на него (не назад); иначе
    /// остаётся на последнем keepalive. <c>to_ts</c> закрытого = начало «связь не жива».
    /// </summary>
    Task CloseAsync(short sourceId, LinkCloseReason reason, DateTimeOffset? atTs, CancellationToken cancellationToken);

    /// <summary>
    /// Самый свежий (по <c>from_ts</c>) интервал связи источника — «предыдущее подключение» (QUIK-style
    /// контекст при новом connect). null — истории нет. Вызывать ДО нового <see cref="HeartbeatAsync"/>,
    /// иначе последним станет только что открытый интервал.
    /// </summary>
    Task<LinkInterval?> GetLastAsync(short sourceId, CancellationToken cancellationToken);

    /// <summary>Интервалы связи источников, пересекающие окно [from, to] (для ленты Connection).</summary>
    Task<IReadOnlyList<LinkInterval>> QueryAsync(
        IReadOnlyCollection<short> sourceIds, DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken);

    /// <summary>
    /// Периоды «связь не жива»: негативное пространство между интервалами, пересекающее окно [from, to].
    /// Причина — <c>close_reason</c> предшествующего интервала (в т.ч. добровольный <see cref="LinkCloseReason.Disconnected"/>
    /// — серый на ленте). <see cref="LinkGap.To"/> == null → период ещё длится (связь так и не поднялась).
    /// </summary>
    Task<IReadOnlyList<LinkGap>> QueryGapsAsync(
        IReadOnlyCollection<short> sourceIds, DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken);

    /// <summary>
    /// Recovery на старте хоста: закрывает все открытые интервалы (прошлый процесс мог упасть) причиной
    /// <see cref="LinkCloseReason.Interrupted"/>. <c>to_ts</c> остаётся на последнем keepalive. Возвращает
    /// число закрытых интервалов.
    /// </summary>
    Task<int> RecoverOpenIntervalsAsync(CancellationToken cancellationToken);
}

/// <summary>Причина закрытия интервала связи (link_liveness). Драйвит цвет периода «связь не жива» на ленте.</summary>
public enum LinkCloseReason
{
    /// <summary>Пользователь отключил провайдера — намеренно, НЕ разрыв (серый на ленте).</summary>
    Disconnected,

    /// <summary><c>server_status=false/error</c> — обрыв связи (точное время события; красный).</summary>
    ServerDown,

    /// <summary>Тишина в сессии + активный пинг не прошёл — «тихая смерть» коннектора/DLL (красный).</summary>
    PingFailed,

    /// <summary>Краш хоста / пропуск keepalive — закрыто recovery на старте или split'ом (красный).</summary>
    Interrupted,
}

/// <summary>Интервал живости связи: [From, To], <see cref="Open"/> = ещё продлевается keepalive.</summary>
public sealed record LinkInterval
{
    public required short SourceId { get; init; }
    public required DateTimeOffset From { get; init; }
    public required DateTimeOffset To { get; init; }
    public required bool Open { get; init; }

    /// <summary>Причина закрытия; null пока <see cref="Open"/>.</summary>
    public LinkCloseReason? CloseReason { get; init; }
}

/// <summary>
/// Период «связь не жива» (производное от <see cref="LinkInterval"/>, не хранится): [From, To) между
/// соседними интервалами. <see cref="To"/> == null → период ещё длится.
/// </summary>
public sealed record LinkGap
{
    public required short SourceId { get; init; }
    public required DateTimeOffset From { get; init; }
    public DateTimeOffset? To { get; init; }
    public required LinkCloseReason Cause { get; init; }
}
