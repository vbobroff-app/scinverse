using Dapper;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Storage.Timescale;

/// <summary>
/// Жизненный цикл связи подключения (link_liveness, phase 7h.8) в компактной интервальной форме.
/// Keepalive продлевает открытый интервал; обрыв/дисконнект/краш закрывают с причиной; восстановление
/// открывает новый. Негативное пространство между интервалами = «связь не жива» (лента Connection).
/// </summary>
public sealed class LinkLivenessStore(Npgsql.NpgsqlDataSource dataSource) : ILinkLivenessStore
{
    private sealed record OpenRow(long LivenessId, DateTime ToTs);

    private sealed record IntervalRow(short SourceId, DateTime From, DateTime To, bool Open, string? CloseReason);

    private sealed record GapRow(short SourceId, DateTime From, DateTime? To, string Cause);

    public async Task HeartbeatAsync(short sourceId, DateTimeOffset ts, TimeSpan maxGap, CancellationToken cancellationToken)
    {
        var tsUtc = ts.ToUniversalTime();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);

        // 7j.19/I7: сериализуем конкурентные keepalive-хартбиты одного источника (тик LivenessProbe +
        // ConnectionManager на смене link-state). Без открытого интервала FOR UPDATE не на чем висеть →
        // два INSERT → нарушение uq_link_liveness_open. Advisory-xact-lock снимается на commit/rollback
        // (namespace 910020 = link_liveness).
        await connection.ExecuteAsync(new CommandDefinition(
            "SELECT pg_advisory_xact_lock(910020, @sourceId);",
            new { sourceId = (int)sourceId }, transaction: tx, cancellationToken: cancellationToken));

        var open = await connection.QuerySingleOrDefaultAsync<OpenRow?>(new CommandDefinition(
            "SELECT liveness_id AS LivenessId, to_ts AS ToTs FROM link_liveness " +
            "WHERE source_id = @sourceId AND open FOR UPDATE;",
            new { sourceId }, transaction: tx, cancellationToken: cancellationToken));

        if (open is null)
        {
            await InsertOpenAsync(connection, tx, sourceId, tsUtc, cancellationToken);
        }
        else if (tsUtc.UtcDateTime - open.ToTs <= maxGap)
        {
            // Продлеваем открытый интервал (монотонно — на случай перескока часов).
            await connection.ExecuteAsync(new CommandDefinition(
                "UPDATE link_liveness SET to_ts = GREATEST(to_ts, @ts) WHERE liveness_id = @id;",
                new { id = open.LivenessId, ts = tsUtc }, transaction: tx, cancellationToken: cancellationToken));
        }
        else
        {
            // Пропущены keepalive-тики (> maxGap) = неявный обрыв процесса: закрываем старый, открываем новый.
            await connection.ExecuteAsync(new CommandDefinition(
                "UPDATE link_liveness SET open = false, close_reason = @reason WHERE liveness_id = @id;",
                new { id = open.LivenessId, reason = ToDb(LinkCloseReason.Interrupted) },
                transaction: tx, cancellationToken: cancellationToken));
            await InsertOpenAsync(connection, tx, sourceId, tsUtc, cancellationToken);
        }

        await tx.CommitAsync(cancellationToken);
    }

    private static Task<int> InsertOpenAsync(
        Npgsql.NpgsqlConnection connection, System.Data.Common.DbTransaction tx,
        short sourceId, DateTimeOffset tsUtc, CancellationToken cancellationToken) =>
        connection.ExecuteAsync(new CommandDefinition(
            "INSERT INTO link_liveness (source_id, from_ts, to_ts, open) VALUES (@sourceId, @ts, @ts, true);",
            new { sourceId, ts = tsUtc }, transaction: tx, cancellationToken: cancellationToken));

    public async Task<int> CloseAsync(
        short sourceId, LinkCloseReason reason, DateTimeOffset? atTs, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        // atTs (точное время события, напр. server_down) сдвигает to_ts вперёд (не назад — иначе период < 0).
        return await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE link_liveness
            SET open = false,
                close_reason = @reason,
                to_ts = CASE WHEN @atTs IS NULL THEN to_ts ELSE GREATEST(to_ts, @atTs) END
            WHERE source_id = @sourceId AND open;
            """,
            new { sourceId, reason = ToDb(reason), atTs = atTs?.ToUniversalTime() },
            cancellationToken: cancellationToken));
    }

    public async Task<LinkInterval?> GetLastAsync(short sourceId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<IntervalRow?>(new CommandDefinition(
            """
            SELECT source_id AS SourceId, from_ts AS "From", to_ts AS "To", open AS Open, close_reason AS CloseReason
            FROM link_liveness
            WHERE source_id = @sourceId
              AND (open OR to_ts > from_ts) -- 7j.20/J6: «предыдущее подключение» = реальный интервал, не нулевой маркер
            ORDER BY from_ts DESC
            LIMIT 1;
            """,
            new { sourceId }, cancellationToken: cancellationToken));

        return row is null
            ? null
            : new LinkInterval
            {
                SourceId = row.SourceId,
                From = ToUtcOffset(row.From),
                To = ToUtcOffset(row.To),
                Open = row.Open,
                CloseReason = row.CloseReason is null ? null : FromDb(row.CloseReason),
            };
    }

    public async Task<IReadOnlyList<LinkInterval>> QueryAsync(
        IReadOnlyCollection<short> sourceIds, DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken)
    {
        if (sourceIds.Count == 0)
        {
            return [];
        }

        var ids = sourceIds.Distinct().ToArray();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<IntervalRow>(new CommandDefinition(
            """
            SELECT source_id AS SourceId, from_ts AS "From", to_ts AS "To", open AS Open, close_reason AS CloseReason
            FROM link_liveness
            WHERE source_id = ANY(@ids) AND from_ts < @to AND (open OR to_ts > @from)
            ORDER BY source_id, from_ts;
            """,
            new { ids, from = from.ToUniversalTime(), to = to.ToUniversalTime() },
            cancellationToken: cancellationToken));

        return rows.Select(r => new LinkInterval
        {
            SourceId = r.SourceId,
            From = ToUtcOffset(r.From),
            To = ToUtcOffset(r.To),
            Open = r.Open,
            CloseReason = r.CloseReason is null ? null : FromDb(r.CloseReason),
        }).ToList();
    }

    public async Task<IReadOnlyList<LinkGap>> QueryGapsAsync(
        IReadOnlyCollection<short> sourceIds, DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken)
    {
        if (sourceIds.Count == 0)
        {
            return [];
        }

        var ids = sourceIds.Distinct().ToArray();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        // Период «связь не жива» = [to_ts закрытого интервала, from_ts следующего). Причина = close_reason
        // предыдущего; для ленты Connection показываем ВСЕ причины (в т.ч. 'disconnected' — серый).
        var rows = await connection.QueryAsync<GapRow>(new CommandDefinition(
            """
            SELECT source_id AS SourceId, gap_from AS "From", gap_to AS "To", cause AS Cause
            FROM (
                SELECT source_id,
                       to_ts AS gap_from,
                       lead(from_ts) OVER (PARTITION BY source_id ORDER BY from_ts) AS gap_to,
                       close_reason AS cause
                FROM link_liveness
                WHERE source_id = ANY(@ids)
            ) g
            WHERE cause IS NOT NULL
              AND gap_from < @to
              AND (gap_to IS NULL OR gap_to > @from)
            ORDER BY source_id, gap_from;
            """,
            new { ids, from = from.ToUniversalTime(), to = to.ToUniversalTime() },
            cancellationToken: cancellationToken));

        var raw = rows.Select(r => new LinkGap
        {
            SourceId = r.SourceId,
            From = ToUtcOffset(r.From),
            To = r.To is { } dt ? ToUtcOffset(dt) : null,
            Cause = FromDb(r.Cause),
        }).ToList();

        return CoalesceOwnerPhases(raw);
    }

    /// <summary>
    /// 7j.20/J6: склеивает соседние сырые дырки, стыкующиеся ВПЛОТНУЮ (<c>prev.To == next.From</c> —
    /// признак нулевого маркера границы владельца, вставленного <see cref="InsertBoundaryMarkerAsync"/>), в
    /// ОДНУ дырку инцидента. Простой = [From, To] целиком (для сверки с записанными данными); момент первой
    /// смены владельца выносим в <c>EscalatedAt</c>/<c>EscalatedCause</c> (только для раскраски ленты).
    /// Дырки, разделённые РЕАЛЬНЫМ живым интервалом (ненулевым), — разные инциденты, не склеиваются.
    /// Маркер <c>scheduled</c>/<c>disconnected</c> на стыке — клип инцидента (<see cref="LinkGap.Abandoned"/>),
    /// не handover и не серое тело в составе break.
    /// </summary>
    private static List<LinkGap> CoalesceOwnerPhases(List<LinkGap> gaps)
    {
        var result = new List<LinkGap>(gaps.Count);
        foreach (var gap in gaps)
        {
            if (result.Count > 0
                && result[^1] is { SourceId: var prevSource, To: { } prevTo } prev
                && prevSource == gap.SourceId
                && prevTo == gap.From)
            {
                // Конец окна / manual: нулевой (или серый) маркер обрезает break без green.
                if (IsNonIncidentCause(gap.Cause))
                {
                    if (!IsNonIncidentCause(prev.Cause))
                    {
                        result[^1] = prev with { Abandoned = true };
                    }

                    // Нулевой маркер в выдачу не кладём; ненулевой серый хвост (idle) — отдельной дыркой.
                    if (gap.To is null || gap.To > gap.From)
                    {
                        result.Add(gap);
                    }

                    continue;
                }

                result[^1] = prev with
                {
                    To = gap.To,
                    // Первая граница = переход жёлтое→красное; последующие маркеры (если есть) не сдвигают.
                    EscalatedAt = prev.EscalatedAt ?? gap.From,
                    EscalatedCause = prev.EscalatedCause ?? gap.Cause,
                };
                continue;
            }

            // Одиночный нулевой scheduled/disconnected-маркер без предшественника — служебный, пропускаем.
            if (IsNonIncidentCause(gap.Cause) && gap.To == gap.From)
            {
                continue;
            }

            result.Add(gap);
        }

        return result;
    }

    private static bool IsNonIncidentCause(LinkCloseReason cause) =>
        cause is LinkCloseReason.Scheduled or LinkCloseReason.Disconnected;

    public async Task<int> RecoverOpenIntervalsAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.ExecuteAsync(new CommandDefinition(
            "UPDATE link_liveness SET open = false, close_reason = @reason WHERE open;",
            new { reason = ToDb(LinkCloseReason.Interrupted) },
            cancellationToken: cancellationToken));
    }

    public async Task InsertBoundaryMarkerAsync(
        short sourceId, LinkCloseReason reason, DateTimeOffset atTs, CancellationToken cancellationToken)
    {
        // Нулевой закрытый интервал [atTs, atTs]: не «живой» (open=false, from==to), но даёт lead()-гэпам
        // точку раздела владельца. Открытого интервала во время Degraded нет — конфликта с uq_open нет.
        var tsUtc = atTs.ToUniversalTime();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            "INSERT INTO link_liveness (source_id, from_ts, to_ts, open, close_reason) " +
            "VALUES (@sourceId, @ts, @ts, false, @reason);",
            new { sourceId, ts = tsUtc, reason = ToDb(reason) },
            cancellationToken: cancellationToken));
    }

    private static DateTimeOffset ToUtcOffset(DateTime ts) =>
        new(DateTime.SpecifyKind(ts, DateTimeKind.Unspecified), TimeSpan.Zero);

    private static string ToDb(LinkCloseReason reason) => reason switch
    {
        LinkCloseReason.Disconnected => "disconnected",
        LinkCloseReason.ServerDown => "server_down",
        LinkCloseReason.PingFailed => "ping_failed",
        LinkCloseReason.Interrupted => "interrupted",
        LinkCloseReason.Scheduled => "scheduled",
        LinkCloseReason.Degraded => "degraded",
        _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
    };

    private static LinkCloseReason FromDb(string reason) => reason switch
    {
        "disconnected" => LinkCloseReason.Disconnected,
        "server_down" => LinkCloseReason.ServerDown,
        "ping_failed" => LinkCloseReason.PingFailed,
        "interrupted" => LinkCloseReason.Interrupted,
        "scheduled" => LinkCloseReason.Scheduled,
        "degraded" => LinkCloseReason.Degraded,
        _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
    };
}
