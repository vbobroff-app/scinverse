using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// NC для force-refresh справочника: два независимых corr/group —
/// «Кэш справочника» и «Актуальность» (lifecycle). Сброс OPT — шаг внутри кэша.
/// </summary>
public sealed class CatalogRefreshNc(INotificationPublisher notifications)
{
    public const string Module = "ohs.instruments";

    private readonly object _gate = new();
    private string? _pendingCacheCorr;

    /// <summary>
    /// Публикует две операции после force refresh. Cache остаётся underway до
    /// <see cref="OnCatalogMarkedFresh"/> (idle persist после dump).
    /// <paramref name="sessionLive"/> — есть живая TRANSAQ-сессия: dump сам не придёт, нужен reconnect.
    /// </summary>
    public (string CacheCorr, string LifecycleCorr) PublishForceRefresh(
        bool invalidated,
        InstrumentLifecycleSweepResult sweep,
        bool sessionLive = false)
    {
        var runId = Guid.NewGuid().ToString("N")[..12];
        var cacheCorr = $"instruments.catalog.cache:{runId}";
        var lifecycleCorr = $"instruments.catalog.lifecycle:{runId}";

        lock (_gate)
        {
            if (_pendingCacheCorr is { } previous)
            {
                Publish(
                    previous,
                    "instruments.catalog.cache.superseded",
                    "Кэш справочника: заменено новым обновлением",
                    severity: "warning",
                    sourceType: "system",
                    status: "resolved",
                    groupKind: NotificationThreadData.GroupKindAction);
            }

            _pendingCacheCorr = cacheCorr;
        }

        PublishCacheSteps(cacheCorr, invalidated, sessionLive);
        PublishLifecycleSteps(lifecycleCorr, sweep);
        return (cacheCorr, lifecycleCorr);
    }

    /// <summary>Dump принят / idle persist → MarkFresh: закрыть pending cache-операцию.</summary>
    public void OnCatalogMarkedFresh()
    {
        string? corr;
        lock (_gate)
        {
            corr = _pendingCacheCorr;
            _pendingCacheCorr = null;
        }

        if (corr is null)
        {
            return;
        }

        Publish(
            corr,
            "instruments.catalog.cache.fresh",
            "Кэш справочника: dump принят, каталог обновлён",
            severity: "ok",
            sourceType: "system",
            status: "resolved",
            groupKind: NotificationThreadData.GroupKindAction);
    }

    private void PublishCacheSteps(string corr, bool invalidated, bool sessionLive)
    {
        Publish(
            corr,
            "instruments.catalog.cache.start",
            "Кэш справочника: обновление запущено",
            severity: "info",
            sourceType: "user",
            status: "active",
            groupKind: NotificationThreadData.GroupKindAction);

        Publish(
            corr,
            "instruments.catalog.cache.invalidate",
            invalidated
                ? "Кэш справочника: invalidate → stale"
                : "Кэш справочника: уже был помечен к обновлению",
            severity: "info",
            sourceType: "system",
            status: "underway",
            groupKind: NotificationThreadData.GroupKindAction);

        Publish(
            corr,
            "instruments.catalog.cache.opt_reset",
            "Кэш справочника: окна опционов (ATM) сброшены",
            severity: "info",
            sourceType: "system",
            status: "underway",
            groupKind: NotificationThreadData.GroupKindAction);

        // Живая сессия dump не повторяет — иначе оператор видит «ожидание» при зелёном тумблере.
        var waitMsg = sessionLive
            ? "Кэш справочника: нужен reconnect — текущая сессия dump не повторит"
            : "Кэш справочника: ожидание dump с коннектора (connect)";
        Publish(
            corr,
            "instruments.catalog.cache.wait_dump",
            waitMsg,
            severity: sessionLive ? "warning" : "info",
            sourceType: "system",
            status: "underway",
            groupKind: NotificationThreadData.GroupKindAction);
    }

    private void PublishLifecycleSteps(string corr, InstrumentLifecycleSweepResult sweep)
    {
        Publish(
            corr,
            "instruments.catalog.lifecycle.start",
            "Актуальность каталога: проверка по экспирации",
            severity: "info",
            sourceType: "user",
            status: "active",
            groupKind: NotificationThreadData.GroupKindLifecycle);

        if (!sweep.Ran)
        {
            Publish(
                corr,
                "instruments.catalog.lifecycle.skipped",
                "Актуальность каталога: sweep пропущен (уже выполнен сегодня)",
                severity: "info",
                sourceType: "system",
                status: "resolved",
                groupKind: NotificationThreadData.GroupKindLifecycle);
            return;
        }

        var n = sweep.ArchivedInstrumentIds.Count;
        Publish(
            corr,
            "instruments.catalog.lifecycle.done",
            n > 0
                ? $"Актуальность каталога: архивировано {n} инструмент(ов)"
                : "Актуальность каталога: просроченных не найдено",
            severity: n > 0 ? "warning" : "ok",
            sourceType: "system",
            status: "resolved",
            groupKind: NotificationThreadData.GroupKindLifecycle,
            data: new { archivedCount = n, archivedInstrumentIds = sweep.ArchivedInstrumentIds });
    }

    private void Publish(
        string correlationId,
        string code,
        string message,
        string severity,
        string sourceType,
        string status,
        string groupKind,
        object? data = null)
    {
        notifications.Publish(
            code,
            message,
            severity: severity,
            sourceType: sourceType,
            module: Module,
            data: NotificationThreadData.WithHints(
                data ?? new { },
                threadKindHint: NotificationThreadData.KindGroup,
                groupKind: groupKind),
            status: status,
            correlationId: correlationId);
    }
}
