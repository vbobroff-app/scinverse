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
    /// </summary>
    public (string CacheCorr, string LifecycleCorr) PublishForceRefresh(
        bool invalidated,
        InstrumentLifecycleSweepResult sweep)
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
                    status: "resolved");
            }

            _pendingCacheCorr = cacheCorr;
        }

        PublishCacheSteps(cacheCorr, invalidated);
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
            "Кэш справочника: dump принят, каталог снова свежий",
            severity: "ok",
            sourceType: "system",
            status: "resolved");
    }

    private void PublishCacheSteps(string corr, bool invalidated)
    {
        Publish(
            corr,
            "instruments.catalog.cache.start",
            "Кэш справочника: обновление запущено",
            severity: "info",
            sourceType: "user",
            status: "active");

        Publish(
            corr,
            "instruments.catalog.cache.invalidate",
            invalidated
                ? "Кэш справочника: invalidate → stale"
                : "Кэш справочника: уже был помечен к обновлению",
            severity: "info",
            sourceType: "system",
            status: "underway");

        Publish(
            corr,
            "instruments.catalog.cache.opt_reset",
            "Кэш справочника: окна опционов (ATM) сброшены",
            severity: "info",
            sourceType: "system",
            status: "underway");

        Publish(
            corr,
            "instruments.catalog.cache.wait_dump",
            "Кэш справочника: ожидание dump с коннектора (connect/reconnect)",
            severity: "info",
            sourceType: "system",
            status: "underway");
    }

    private void PublishLifecycleSteps(string corr, InstrumentLifecycleSweepResult sweep)
    {
        Publish(
            corr,
            "instruments.catalog.lifecycle.start",
            "Актуальность каталога: проверка по экспирации",
            severity: "info",
            sourceType: "user",
            status: "active");

        if (!sweep.Ran)
        {
            Publish(
                corr,
                "instruments.catalog.lifecycle.skipped",
                "Актуальность каталога: sweep пропущен (уже выполнен сегодня)",
                severity: "info",
                sourceType: "system",
                status: "resolved");
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
            data: new { archivedCount = n, archivedInstrumentIds = sweep.ArchivedInstrumentIds });
    }

    private void Publish(
        string correlationId,
        string code,
        string message,
        string severity,
        string sourceType,
        string status,
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
                threadKindHint: NotificationThreadData.KindGroup),
            status: status,
            correlationId: correlationId);
    }
}
