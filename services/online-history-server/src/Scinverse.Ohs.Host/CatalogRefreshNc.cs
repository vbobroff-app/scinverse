using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// NC каталога: Refresh (Action + Checkup) и суточный Lifecycle.
/// Ось groupKind — периодичность vs разовая health-проверка (не «была ли мутация»).
/// Checkup: force, check-health, ad-hoc probe и т.п. — однократный осмотр.
/// Post-dump sync продолжается в той же lifecycle/checkup-нити, что и sweep.
/// </summary>
public sealed class CatalogRefreshNc(INotificationPublisher notifications)
{
    public const string Module = "ohs.instruments";
    private const int DetailCap = 80;

    private readonly object _gate = new();
    private string? _pendingCacheCorr;
    /// <summary>Нить, ждущая post-dump sync наборов (суточный Lifecycle или Refresh Checkup).</summary>
    private string? _pendingPostDumpCorr;
    private string? _pendingPostDumpGroupKind;

    /// <summary>
    /// Force Refresh: два corr — кэш (Action) и актуальность (Checkup: force / health-check).
    /// Checkup остаётся underway до post-dump sync наборов.
    /// </summary>
    public (string CacheCorr, string CheckupCorr) PublishForceRefresh(
        bool invalidated,
        InstrumentLifecycleSweepResult sweep,
        bool sessionLive = false)
    {
        var runId = Guid.NewGuid().ToString("N")[..12];
        var cacheCorr = $"instruments.catalog.cache:{runId}";
        var checkupCorr = $"instruments.catalog.checkup:{runId}";

        lock (_gate)
        {
            if (_pendingCacheCorr is { } previous)
            {
                Publish(
                    previous,
                    "instruments.catalog.cache.superseded",
                    "Справочник: предыдущее обновление заменено новым",
                    severity: "warning",
                    sourceType: "system",
                    status: "resolved",
                    groupKind: NotificationThreadData.GroupKindAction);
            }

            _pendingCacheCorr = cacheCorr;
            AbandonPendingPostDumpLocked("обновление справочника перезапущено");
            if (sweep.Ran)
            {
                _pendingPostDumpCorr = checkupCorr;
                _pendingPostDumpGroupKind = NotificationThreadData.GroupKindCheckup;
            }
        }

        PublishCacheSteps(cacheCorr, invalidated, sessionLive);
        PublishSweepSteps(
            checkupCorr,
            sweep,
            groupKind: NotificationThreadData.GroupKindCheckup,
            sourceTypeStart: "user",
            title: "Проверка актуальности");
        return (cacheCorr, checkupCorr);
    }

    /// <summary>
    /// Суточный авто-sweep на первом connect checkup-суток: Lifecycle (периодический процесс жизни).
    /// Underway до post-dump sync.
    /// </summary>
    public string PublishDailyLifecycle(InstrumentLifecycleSweepResult sweep)
    {
        var runId = Guid.NewGuid().ToString("N")[..12];
        var corr = $"instruments.catalog.lifecycle:{runId}";

        lock (_gate)
        {
            AbandonPendingPostDumpLocked("начата новая суточная актуализация");
            if (sweep.Ran)
            {
                _pendingPostDumpCorr = corr;
                _pendingPostDumpGroupKind = NotificationThreadData.GroupKindLifecycle;
            }
        }

        PublishSweepSteps(
            corr,
            sweep,
            groupKind: NotificationThreadData.GroupKindLifecycle,
            sourceTypeStart: "system",
            title: "Суточная актуализация каталога");
        return corr;
    }

    /// <summary>
    /// После dump/Available: дописать новые тикеры в наборы.
    /// Продолжает pending lifecycle/checkup; иначе отдельная короткая checkup-нить (разовая сверка).
    /// </summary>
    public string PublishBasketSyncAfterDump(IReadOnlyList<BasketMemberChange>? added = null)
    {
        added ??= [];
        string corr;
        string groupKind;
        lock (_gate)
        {
            if (_pendingPostDumpCorr is { } pending && _pendingPostDumpGroupKind is { } kind)
            {
                corr = pending;
                groupKind = kind;
                _pendingPostDumpCorr = null;
                _pendingPostDumpGroupKind = null;
            }
            else
            {
                var runId = Guid.NewGuid().ToString("N")[..12];
                corr = $"instruments.catalog.baskets:{runId}";
                groupKind = NotificationThreadData.GroupKindCheckup;
            }
        }

        var isContinuation = !corr.StartsWith("instruments.catalog.baskets:", StringComparison.Ordinal);

        if (!isContinuation)
        {
            Publish(
                corr,
                "instruments.catalog.baskets.sync_start",
                "Наборы: сверка со справочником",
                severity: "info",
                sourceType: "system",
                status: "active",
                groupKind: groupKind);
        }

        var n = added.Count;
        Publish(
            corr,
            isContinuation
                ? $"{CorrPrefix(corr)}.baskets_new"
                : "instruments.catalog.baskets.sync_members",
            $"Наборы: добавлено ({n}) инструментов по правилам (новые из справочника)",
            severity: n > 0 ? "ok" : "info",
            sourceType: "system",
            status: "underway",
            groupKind: groupKind,
            data: MemberChangesData(added));

        Publish(
            corr,
            isContinuation
                ? $"{CorrPrefix(corr)}.done"
                : "instruments.catalog.baskets.sync_done",
            isContinuation
                ? DoneMessage(groupKind)
                : "Наборы и список наблюдения обновлены",
            severity: "ok",
            sourceType: "system",
            status: "resolved",
            groupKind: groupKind);

        return corr;
    }

    /// <summary>
    /// Dump принят / idle persist → MarkFresh: закрыть pending cache-операцию.
    /// </summary>
    /// <returns>true — закрыли pending Refresh cache-corr (нужен force basket sync).</returns>
    public bool OnCatalogMarkedFresh()
    {
        string? corr;
        lock (_gate)
        {
            corr = _pendingCacheCorr;
            _pendingCacheCorr = null;
        }

        if (corr is null)
        {
            return false;
        }

        Publish(
            corr,
            "instruments.catalog.cache.fresh",
            "Справочник: dump принят, кэш обновлён",
            severity: "ok",
            sourceType: "system",
            status: "resolved",
            groupKind: NotificationThreadData.GroupKindAction);
        return true;
    }

    private void PublishCacheSteps(string corr, bool invalidated, bool sessionLive)
    {
        Publish(
            corr,
            "instruments.catalog.cache.start",
            "Справочник: обновление кэша запущено",
            severity: "info",
            sourceType: "user",
            status: "active",
            groupKind: NotificationThreadData.GroupKindAction);

        Publish(
            corr,
            "instruments.catalog.cache.invalidate",
            invalidated
                ? "Справочник: кэш помечен к обновлению"
                : "Справочник: кэш уже был помечен к обновлению",
            severity: "info",
            sourceType: "system",
            status: "underway",
            groupKind: NotificationThreadData.GroupKindAction);

        Publish(
            corr,
            "instruments.catalog.cache.opt_reset",
            "Справочник: окна опционов сброшены",
            severity: "info",
            sourceType: "system",
            status: "underway",
            groupKind: NotificationThreadData.GroupKindAction);

        var waitMsg = sessionLive
            ? "Справочник: нужен reconnect — текущая сессия dump не повторит"
            : "Справочник: ожидание dump с коннектора";
        Publish(
            corr,
            "instruments.catalog.cache.wait_dump",
            waitMsg,
            severity: sessionLive ? "warning" : "info",
            sourceType: "system",
            status: "underway",
            groupKind: NotificationThreadData.GroupKindAction);
    }

    private void PublishSweepSteps(
        string corr,
        InstrumentLifecycleSweepResult sweep,
        string groupKind,
        string sourceTypeStart,
        string title)
    {
        var prefix = CorrPrefix(corr);

        Publish(
            corr,
            $"{prefix}.start",
            $"{title}: проверка по экспирации",
            severity: "info",
            sourceType: sourceTypeStart,
            status: "active",
            groupKind: groupKind);

        if (!sweep.Ran)
        {
            Publish(
                corr,
                $"{prefix}.skipped",
                $"{title}: уже выполнен сегодня",
                severity: "info",
                sourceType: "system",
                status: "resolved",
                groupKind: groupKind);
            return;
        }

        var archived = sweep.ArchivedInstrumentIds.Count;
        Publish(
            corr,
            $"{prefix}.archive",
            archived > 0
                ? $"{title}: в архив {archived} просроченн(ых) инструмент(ов)"
                : $"{title}: просроченных нет",
            severity: archived > 0 ? "warning" : "ok",
            sourceType: "system",
            status: "underway",
            groupKind: groupKind,
            data: new { archivedCount = archived, archivedInstrumentIds = sweep.ArchivedInstrumentIds });

        var removed = sweep.Removals;
        var removedN = removed.Count;
        Publish(
            corr,
            $"{prefix}.baskets_expired",
            $"{title}: из наборов убрано ({removedN}) просроченных",
            severity: removedN > 0 ? "warning" : "info",
            sourceType: "system",
            status: "underway",
            groupKind: groupKind,
            data: MemberChangesData(removed));

        Publish(
            corr,
            $"{prefix}.observed",
            $"{title}: список наблюдения обновлён",
            severity: "info",
            sourceType: "system",
            status: "underway",
            groupKind: groupKind);

        Publish(
            corr,
            $"{prefix}.wait_dump",
            $"{title}: ожидание справочника — затем допишем новые тикеры в наборы",
            severity: "info",
            sourceType: "system",
            status: "underway",
            groupKind: groupKind);
    }

    private static object MemberChangesData(IReadOnlyList<BasketMemberChange> changes)
    {
        var n = changes.Count;
        if (n == 0)
        {
            return new { count = 0 };
        }

        var items = changes
            .Take(DetailCap)
            .Select(c => new
            {
                basket = c.BasketName,
                basketId = c.BasketId,
                label = c.Label,
                instrumentId = c.InstrumentId,
            })
            .ToList();

        return new
        {
            count = n,
            truncated = n > DetailCap,
            items,
        };
    }

    private void AbandonPendingPostDumpLocked(string reason)
    {
        if (_pendingPostDumpCorr is not { } corr || _pendingPostDumpGroupKind is not { } kind)
        {
            return;
        }

        _pendingPostDumpCorr = null;
        _pendingPostDumpGroupKind = null;
        Publish(
            corr,
            $"{CorrPrefix(corr)}.superseded",
            $"Актуализация прервана: {reason}",
            severity: "warning",
            sourceType: "system",
            status: "resolved",
            groupKind: kind);
    }

    private static string CorrPrefix(string corr)
    {
        if (corr.StartsWith("instruments.catalog.lifecycle:", StringComparison.Ordinal))
        {
            return "instruments.catalog.lifecycle";
        }

        if (corr.StartsWith("instruments.catalog.checkup:", StringComparison.Ordinal))
        {
            return "instruments.catalog.checkup";
        }

        return "instruments.catalog.baskets";
    }

    private static string DoneMessage(string groupKind) =>
        string.Equals(groupKind, NotificationThreadData.GroupKindLifecycle, StringComparison.Ordinal)
            ? "Суточная актуализация каталога: готово (архив + наборы + новые тикеры)"
            : "Проверка актуальности: готово (архив + наборы + новые тикеры)";

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
