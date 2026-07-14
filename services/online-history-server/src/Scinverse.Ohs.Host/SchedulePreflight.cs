using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Domain.Finam;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Pre-flight сверки расписания (phase 7i): перед постановкой инструмента на авто-запись спрашиваем
/// расписание у НАЗНАЧЕННОГО источника (external_service.use_for_schedule), сравниваем с базой
/// (market_schedule) на сегодняшнюю дату и при расхождении заводим исключение (market_schedule_exception,
/// resolved=false) — пользователь потом решит: оставить или поднять в базу. См. docs/dev/phase7i/schedule.md.
/// </summary>
public sealed class SchedulePreflight(
    IExternalServiceStore services,
    IInstrumentRegistry registry,
    IInstrumentStore instruments,
    IMarketScheduleStore schedule,
    IFuturesAssetClassStore assetClasses,
    IFinamApi finam,
    TimeProvider time,
    ILogger<SchedulePreflight> logger)
{
    /// <summary>Окно торгов на дату: (open, close). (null, null) = торгов нет.</summary>
    private readonly record struct Window(TimeOnly? Open, TimeOnly? Close)
    {
        public bool NoTrade => Open is null || Close is null;
        public override string ToString() => NoTrade ? "нет торгов" : $"{Open:HH\\:mm}–{Close:HH\\:mm}";
    }

    /// <summary>
    /// Запрашивает расписание инструмента у источника и сверяет с базой. Возвращает расписание или null
    /// (источник не назначен / символ не сопоставлен / нет секрета / ошибка) — pre-flight никогда не роняет
    /// постановку на auto.
    /// </summary>
    public async Task<FinamSchedule?> RequestAsync(long instrumentId, CancellationToken cancellationToken)
    {
        var source = await services.GetScheduleSourceAsync(cancellationToken).ConfigureAwait(false);
        if (source is null || !source.Enabled)
        {
            logger.LogInformation(
                "Pre-flight {InstrumentId}: источник системного расписания не назначен/выключен — пропуск",
                instrumentId);
            return null;
        }

        if (!registry.TryResolveById(instrumentId, out var instrument))
        {
            logger.LogWarning("Pre-flight {InstrumentId}: инструмент не найден в реестре — пропуск", instrumentId);
            return null;
        }

        var symbol = FinamSymbol.TryBuild(instrument.Key);
        if (symbol is null)
        {
            logger.LogWarning(
                "Pre-flight {Key}: board не сопоставлен MIC Finam — пропуск (расширить FinamSymbol)",
                instrument.Key);
            return null;
        }

        var secret = await services.GetSecretAsync(source.ServiceId, cancellationToken).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(secret))
        {
            logger.LogWarning("Pre-flight {Symbol}: у источника «{Source}» не задан секрет — пропуск", symbol, source.Name);
            return null;
        }

        FinamSchedule finamSchedule;
        try
        {
            finamSchedule = await finam.GetScheduleAsync(secret, symbol, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Pre-flight {Symbol}: запрос расписания у «{Source}» не удался", symbol, source.Name);
            return null;
        }

        try
        {
            await CompareAndFlagAsync(instrumentId, instrument.Key, symbol, finamSchedule, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Сверка/запись исключения не должна влиять на постановку на auto — только лог.
            logger.LogWarning(ex, "Pre-flight {Symbol}: сверка с базой не удалась", symbol);
        }

        return finamSchedule;
    }

    private async Task CompareAndFlagAsync(
        long instrumentId, InstrumentKey key, string symbol, FinamSchedule finamSchedule,
        CancellationToken cancellationToken)
    {
        var scope = await ResolveScopeAsync(instrumentId, key, cancellationToken).ConfigureAwait(false);
        if (scope is null)
        {
            logger.LogInformation("Pre-flight {Symbol}: scope не выведен (board вне расписания) — сверка пропущена", symbol);
            return;
        }

        var today = DateOnly.FromDateTime(time.GetUtcNow().ToOffset(MoexSchedule.MoscowOffset).DateTime);

        var baseVersion = await schedule.ResolveAsync(scope, today, cancellationToken).ConfigureAwait(false);
        if (baseVersion is null)
        {
            logger.LogInformation("Pre-flight {Symbol}: базового расписания для рынка «{Market}» нет — сверка пропущена",
                symbol, scope.Market);
            return;
        }

        var baseWindow = BaseWindow(baseVersion, today);
        var finamWindow = FinamWindow(finamSchedule, today);

        if (WindowsEqual(baseWindow, finamWindow))
        {
            logger.LogInformation("Pre-flight {Symbol} {Date}: расписание совпадает с базой ({Window}) — ок",
                symbol, today, baseWindow);
            return;
        }

        var kind = finamWindow.NoTrade ? "no_trade" : "shifted";
        var note = $"Auto pre-flight {symbol}: база {baseWindow}, Finam {finamWindow}";
        var exception = new MarketScheduleException(
            today, scope.Market, scope.SecType, scope.Category, scope.Instrument, kind,
            finamWindow.NoTrade ? null : finamWindow.Open,
            finamWindow.NoTrade ? null : finamWindow.Close,
            "authoritative", "Finam Schedule", Resolved: false, note);

        await schedule.UpsertExceptionAsync(exception, cancellationToken).ConfigureAwait(false);
        logger.LogWarning("Pre-flight {Symbol} {Date}: РАСХОЖДЕНИЕ — {Note}. Заведено исключение ({Kind})",
            symbol, today, note, kind);
    }

    /// <summary>SECID → (market, sec_type, category, instrument) через board + справочник классов БА.</summary>
    private async Task<ScheduleScope?> ResolveScopeAsync(
        long instrumentId, InstrumentKey key, CancellationToken cancellationToken)
    {
        var info = await instruments.GetScopeInfoAsync(instrumentId, cancellationToken).ConfigureAwait(false);
        var board = info?.Board ?? key.Board;
        var market = MarketOf(board);
        if (market is null)
        {
            return null;
        }

        var secType = SecTypeOf(info?.SecType, board);

        string? category = null;
        if (!string.IsNullOrWhiteSpace(info?.UnderlyingCode))
        {
            var classes = await assetClasses.ListAsync(cancellationToken).ConfigureAwait(false);
            category = classes
                .FirstOrDefault(c => string.Equals(c.AssetCode, info!.UnderlyingCode, StringComparison.OrdinalIgnoreCase))
                ?.Category;
        }

        return new ScheduleScope(market, secType, category, key.Ticker);
    }

    private static string? MarketOf(string board) => board.ToUpperInvariant() switch
    {
        "FUT" or "OPT" => "derivatives",
        "TQBR" => "stock",
        _ => null,
    };

    private static string? SecTypeOf(string? secType, string board) =>
        (secType ?? board).ToUpperInvariant() switch
        {
            "FUT" => "futures",
            "OPT" => "options",
            "SHARE" or "TQBR" => "shares",
            "BOND" => "bonds",
            _ => null,
        };

    /// <summary>Окно базовой версии на дату: будни → wd_*, выходной → we_* (null = не торгует).</summary>
    private static Window BaseWindow(MarketScheduleVersion version, DateOnly date)
    {
        var weekend = date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;
        return weekend
            ? new Window(version.WeOpen, version.WeClose)
            : new Window(version.WdOpen, version.WdClose);
    }

    /// <summary>Типы сессий, не считающиеся «рынок открыт» (не входят в торговое окно дня).</summary>
    private static readonly HashSet<string> NonTradingTypes =
        new(StringComparer.OrdinalIgnoreCase) { "CLOSED", "CLEARING" };

    /// <summary>
    /// Окно Finam на дату (МСК): от первого открытия до последнего закрытия торговых сессий (включая
    /// аукционы), НАЧАВШИХСЯ в этот день. Клиринг/CLOSED исключаем — иначе клиринг за полночь «сдвигает»
    /// границы. Сравниваем по времени суток (TimeOnly), а не по абсолютному моменту.
    /// </summary>
    private static Window FinamWindow(FinamSchedule schedule, DateOnly date)
    {
        var times = schedule.Sessions
            .Where(s => !NonTradingTypes.Contains(s.Type))
            .Select(s => (
                Start: s.Start.ToOffset(MoexSchedule.MoscowOffset).DateTime,
                End: s.End.ToOffset(MoexSchedule.MoscowOffset).DateTime))
            .Where(s => DateOnly.FromDateTime(s.Start) == date)
            .ToList();

        if (times.Count == 0)
        {
            return new Window(null, null);
        }

        var open = times.Min(s => TimeOnly.FromDateTime(s.Start));
        var close = times.Max(s => TimeOnly.FromDateTime(s.End));
        return new Window(open, close);
    }

    /// <summary>Сравнение окон с точностью до минут (секунды/тип дня игнорируем).</summary>
    private static bool WindowsEqual(Window a, Window b)
    {
        if (a.NoTrade || b.NoTrade)
        {
            return a.NoTrade && b.NoTrade;
        }

        return SameMinute(a.Open!.Value, b.Open!.Value) && SameMinute(a.Close!.Value, b.Close!.Value);
    }

    private static bool SameMinute(TimeOnly x, TimeOnly y) =>
        x.Hour == y.Hour && x.Minute == y.Minute;
}
