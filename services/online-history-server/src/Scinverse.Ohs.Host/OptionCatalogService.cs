using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Оркестрация load ATM ±N опционов (7h.OPT / 7i.OPT): freshness → subscribe FUT → ATM →
/// families → strikes → get_options → каталог (через pump securities).
/// </summary>
public sealed class OptionCatalogService(
    ConnectionManager connections,
    IInstrumentRegistry registry,
    IInstrumentStore store,
    OptionWindowFreshness freshness,
    OhsOptions options,
    TimeProvider time,
    ILogger<OptionCatalogService> logger)
{
    /// <summary>
    /// Список серий из <c>get_option_families</c> (для expand FUT без OPT в БД).
    /// Не грузит ATM-окно — только mat_date для дерева.
    /// </summary>
    public async Task<IReadOnlyList<InstrumentGroup>> ListOptionFamiliesAsync(
        long connectionId,
        long futuresInstrumentId,
        CancellationToken cancellationToken)
    {
        var (futures, loader, connector) = ResolveLoader(connectionId, futuresInstrumentId);
        var cmdTimeout = CommandTimeout();

        await connector.SubscribeTradesAsync([futures.Key], cancellationToken).ConfigureAwait(false);
        var families = await loader
            .GetOptionFamiliesAsync(futures.Key, cmdTimeout, cancellationToken)
            .ConfigureAwait(false);

        var today = InstrumentLifecycle.TodayMoscow(time);
        var scope = await store.GetScopeInfoAsync(futuresInstrumentId, cancellationToken).ConfigureAwait(false);
        var underlying = scope?.UnderlyingCode;

        return families
            .Where(f => f.Expiration >= today)
            .GroupBy(f => f.Expiration)
            .Select(g => g.First())
            .OrderBy(f => f.Expiration)
            .Select(f => new InstrumentGroup
            {
                Key = f.Expiration.ToString("yyyy-MM-dd"),
                Label = MoexSeries.Label(underlying, f.Expiration),
                Badge = MoexSeries.Badge(f.Expiration, week: null),
                Count = 0,
                Expiration = f.Expiration,
            })
            .ToList();
    }

    public async Task<LoadOptionsResult> EnsureOptionsAsync(
        long connectionId,
        long futuresInstrumentId,
        DateOnly expiration,
        bool force,
        CancellationToken cancellationToken)
    {
        if (expiration < InstrumentLifecycle.TodayMoscow(time))
        {
            return new LoadOptionsResult(false, false, 0, 0, 0, null, "Серия просрочена — OPT-load пропущен");
        }

        if (!force && freshness.IsFresh(connectionId, futuresInstrumentId, expiration))
        {
            return new LoadOptionsResult(false, true, 0, 0, 0, null, "OPT-окно уже свежо сегодня (МСК)");
        }

        var (futures, loader, connector) = ResolveLoader(connectionId, futuresInstrumentId);

        var timeout = TimeSpan.FromSeconds(
            Math.Clamp(options.OptionAtmLiveWaitSeconds > 0 ? options.OptionAtmLiveWaitSeconds : 3, 1, 30));
        var cmdTimeout = CommandTimeout();

        await connector.SubscribeTradesAsync([futures.Key], cancellationToken).ConfigureAwait(false);

        var atm = await loader.WaitFuturesTradePriceAsync(futures.Key, timeout, cancellationToken)
            .ConfigureAwait(false);
        atm ??= await store.GetLastTradePriceAsync(futuresInstrumentId, cancellationToken).ConfigureAwait(false);
        if (atm is null)
        {
            return new LoadOptionsResult(
                false, false, 0, 0, 0, null,
                "Нет ATM: ни живой сделки FUT, ни last из md_trade");
        }

        var families = await loader
            .GetOptionFamiliesAsync(futures.Key, cmdTimeout, cancellationToken)
            .ConfigureAwait(false);
        if (families.Count == 0 || families.All(f => f.Expiration != expiration))
        {
            // Всё равно пробуем strikes по запрошенной mat_date (семейство может не распарситься).
            logger.LogWarning(
                "option_families: {Count} семей, expiration {Exp} не найдена явно — пробуем strikes",
                families.Count, expiration);
        }

        var strikes = await loader
            .GetFamilyStrikesAsync(futures.Key, expiration, cmdTimeout, cancellationToken)
            .ConfigureAwait(false);
        if (strikes.Count == 0)
        {
            return new LoadOptionsResult(
                false, false, 0, families.Count, 0, atm,
                "family_strikes пуст");
        }

        var depth = Math.Clamp(options.OptionAtmDepth, 1, 50);
        var codes = AtmStrikeFilter.SelectOptCodes(strikes, atm.Value, depth);
        if (codes.Count == 0)
        {
            return new LoadOptionsResult(
                false, false, 0, families.Count, strikes.Count, atm,
                "После ATM-фильтра нет opt_code");
        }

        var load = await loader.GetOptionsAsync(codes, cmdTimeout, cancellationToken).ConfigureAwait(false);
        if (!load.Accepted || load.Failed || !load.SecuritiesCallback)
        {
            return new LoadOptionsResult(
                false, false, codes.Count, families.Count, strikes.Count, atm,
                load.Message);
        }

        // securities ушли в Messages → ConnectorSession.Observe → upsert в каталог.
        await Task.Delay(200, cancellationToken).ConfigureAwait(false);
        await registry.FlushPendingAsync(cancellationToken).ConfigureAwait(false);

        freshness.MarkFresh(connectionId, futuresInstrumentId, expiration);
        logger.LogInformation(
            "OPT-load conn={ConnectionId} fut={Futures} exp={Exp}: ATM={Atm} codes={Codes} depth={Depth}",
            connectionId, futures.Key, expiration, atm, codes.Count, depth);

        return new LoadOptionsResult(
            true, false, codes.Count, families.Count, strikes.Count, atm,
            $"Загружено окно ATM ±{depth}: {codes.Count} opt_code");
    }

    private (Instrument Futures, IOptionCatalogLoader Loader, IMarketConnector Connector) ResolveLoader(
        long connectionId, long futuresInstrumentId)
    {
        if (!registry.TryResolveById(futuresInstrumentId, out var futures))
        {
            throw new InvalidOperationException($"Фьючерс {futuresInstrumentId} не в реестре");
        }

        var connector = connections.GetConnector(connectionId)
            ?? throw new InvalidOperationException($"Подключение {connectionId} не активно");

        if (connector is not IOptionCatalogLoader loader)
        {
            throw new InvalidOperationException("Load options доступен для TRANSAQ / synthetic");
        }

        if (!connector.IsConnected)
        {
            throw new InvalidOperationException($"Подключение {connectionId} не connected");
        }

        return (futures, loader, connector);
    }

    private static TimeSpan CommandTimeout() => TimeSpan.FromSeconds(Math.Clamp(10, 3, 60));
}
