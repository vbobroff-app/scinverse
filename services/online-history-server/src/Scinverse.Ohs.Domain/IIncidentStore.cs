namespace Scinverse.Ohs.Domain;

/// <summary>Журнал инцидентов (таблица <c>incident</c>, phase 11.13a).</summary>
public interface IIncidentStore
{
    /// <summary>
    /// Открыть эпизод. Идемпотентно: <c>ON CONFLICT (corr_uid) DO NOTHING</c>.
    /// Возвращает <c>true</c>, если строка вставлена.
    /// </summary>
    Task<bool> OpenAsync(Incident incident, CancellationToken cancellationToken);

    /// <summary>
    /// Обновить незакрытый эпизод (handover / recovering / поля). No-op, если нет строки или уже resolved.
    /// </summary>
    Task<bool> UpdateOpenAsync(Incident incident, CancellationToken cancellationToken);

    /// <summary>
    /// Закрыть эпизод: status=resolved + close_outcome + closed_at.
    /// Опц. <paramref name="resolvedBy"/> → <c>payload.resolvedBy</c> (J7).
    /// No-op, если нет строки или уже resolved.
    /// </summary>
    Task<bool> ResolveAsync(
        string corrUid,
        DateTimeOffset closedAt,
        string closeOutcome,
        string? title,
        string? severity,
        string? resolvedBy,
        CancellationToken cancellationToken);

    /// <summary>Дописать <c>payload.resolvedBy</c> на уже resolved (после CloseBreak-пути).</summary>
    Task<bool> AnnotateResolvedByAsync(
        string corrUid, string resolvedBy, CancellationToken cancellationToken);

    Task<Incident?> GetAsync(string corrUid, CancellationToken cancellationToken);

    /// <summary>
    /// I13: открытый break на connection (active|recovering), newest. SoT для adopt после рестарта —
    /// журнал, не <c>notification</c>/NC.
    /// </summary>
    Task<Incident?> FindOpenBreakAsync(long connectionId, CancellationToken cancellationToken);

    /// <summary>
    /// Проставить <c>connection_id</c>, если ещё null (crash open без привязки → гант Connection).
    /// Работает и для уже resolved.
    /// </summary>
    Task<bool> BindConnectionIdIfNullAsync(
        string corrUid, long connectionId, CancellationToken cancellationToken);

    /// <summary>Список newest-first по <c>opened_at</c> (лимит по умолчанию 100).</summary>
    Task<IReadOnlyList<Incident>> QueryAsync(IncidentQuery query, CancellationToken cancellationToken);

    /// <summary>
    /// P5: заменить scope crash (<c>incident_connection</c>). Идемпотентно: DELETE + INSERT.
    /// Пустой список → только очистка scope.
    /// </summary>
    Task ReplaceConnectionScopeAsync(
        string corrUid, IReadOnlyList<long> connectionIds, CancellationToken cancellationToken);

    /// <summary>P5: connection_id из scope (порядок вставок не гарантирован).</summary>
    Task<IReadOnlyList<long>> ListConnectionScopeAsync(
        string corrUid, CancellationToken cancellationToken);
}
