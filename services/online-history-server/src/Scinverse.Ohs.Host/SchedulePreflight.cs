using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Domain.Schedule;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Pre-flight сверки расписания (phase 7i): перед постановкой инструмента на авто-запись спрашиваем
/// расписание у НАЗНАЧЕННОГО источника (external_service.use_for_schedule) через нейтральный
/// <see cref="IScheduleConfirmer"/> (адаптер по коду), сравниваем с базой (market_schedule) на
/// сегодняшнюю дату и при расхождении заводим исключение (market_schedule_exception, resolved=false) —
/// пользователь потом решит: оставить или поднять в базу. См. docs/dev/phase7i/schedule.md.
/// </summary>
public sealed class SchedulePreflight(
    IExternalServiceStore services,
    IScheduleConfirmerRegistry confirmers,
    IInstrumentRegistry registry,
    IInstrumentStore instruments,
    IMarketScheduleStore schedule,
    IFuturesAssetClassStore assetClasses,
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
    /// Запрашивает расписание инструмента у назначенного источника и сверяет с базой. Pre-flight никогда
    /// не роняет постановку на auto: любая проблема (источник не назначен / адаптер не поддержан / символ
    /// не сопоставлен / нет секрета / ошибка API / сверка) → только лог, без исключения наружу.
    /// </summary>
    public async Task RequestAsync(long instrumentId, CancellationToken cancellationToken)
    {
        var source = await services.GetScheduleSourceAsync(cancellationToken).ConfigureAwait(false);
        if (source is null || !source.Enabled)
        {
            logger.LogInformation(
                "Pre-flight {InstrumentId}: источник системного расписания не назначен/выключен — пропуск",
                instrumentId);
            return;
        }

        var confirmer = confirmers.ForAdapter(source.Adapter);
        if (confirmer is null)
        {
            logger.LogWarning(
                "Pre-flight {InstrumentId}: адаптер «{Adapter}» источника «{Source}» не поддержан — пропуск",
                instrumentId, source.Adapter, source.Name);
            return;
        }

        if (!registry.TryResolveById(instrumentId, out var instrument))
        {
            logger.LogWarning("Pre-flight {InstrumentId}: инструмент не найден в реестре — пропуск", instrumentId);
            return;
        }

        var scope = await ResolveScopeAsync(instrumentId, instrument.Key, cancellationToken).ConfigureAwait(false);
        if (scope is null)
        {
            logger.LogInformation(
                "Pre-flight {Key}: scope не выведен (board вне расписания) — пропуск", instrument.Key);
            return;
        }

        // Символ (Finam: SECID@MIC) и движок (ISS: futures/stock/currency) — адаптер берёт своё.
        var symbol = FinamSymbol.TryBuild(instrument.Key);
        var engine = EngineOf(scope.Market);
        var subject = symbol ?? engine ?? instrument.Key.Ticker;

        string? secret = null;
        if (confirmer.RequiresSecret)
        {
            secret = await services.GetSecretAsync(source.ServiceId, cancellationToken).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(secret))
            {
                logger.LogWarning("Pre-flight {Subject}: у источника «{Source}» не задан секрет — пропуск", subject, source.Name);
                return;
            }
        }

        var today = DateOnly.FromDateTime(time.GetUtcNow().ToOffset(MoexSchedule.MoscowOffset).DateTime);
        var query = new ConfirmerQuery(symbol, engine, today, secret);

        ConfirmerSchedule confirmed;
        try
        {
            confirmed = await confirmer.GetScheduleAsync(query, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Pre-flight {Subject}: запрос расписания у «{Source}» не удался", subject, source.Name);
            return;
        }

        try
        {
            await CompareAndFlagAsync(scope, subject, source.Name, confirmed, today, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Сверка/запись исключения не должна влиять на постановку на auto — только лог.
            logger.LogWarning(ex, "Pre-flight {Subject}: сверка с базой не удалась", subject);
        }

        // Календарная проверка (capability Calendar): праздники/переносы в горизонте вперёд — источник
        // с историей/будущим (ISS dailytable) видит то, что session_schedule (сегодня) и Finam (~2 дня) не видят.
        if (confirmer is ICalendarConfirmer calendarConfirmer && engine is not null)
        {
            try
            {
                await CalendarCheckAsync(calendarConfirmer, engine, scope.Market, source.Name, today, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Pre-flight {Subject}: календарная проверка не удалась", subject);
            }
        }
    }

    /// <summary>Горизонт календарной проверки вперёд (дней) — заранее ловим ближайшие праздники.</summary>
    private const int CalendarHorizonDays = 14;

    /// <summary>
    /// Сверяет торговый календарь движка на горизонт вперёд с базой на уровне РЫНКА: если ISS помечает
    /// день нерабочим (праздник/перенос), а база на этот день ожидает торги — заводит market-scope
    /// исключение <c>no_trade</c> (действует на все инструменты рынка). Дни, где база и так не торгует
    /// (выходные), пропускаем.
    /// </summary>
    private async Task CalendarCheckAsync(
        ICalendarConfirmer calendar, string engine, string market, string sourceName, DateOnly today,
        CancellationToken cancellationToken)
    {
        var cal = await calendar.GetCalendarAsync(engine, today, today.AddDays(CalendarHorizonDays), cancellationToken)
            .ConfigureAwait(false);

        var marketScope = new ScheduleScope(market, null, null, null);
        var flagged = 0;
        foreach (var day in cal.Days.Where(d => !d.IsTradingDay))
        {
            var baseVersion = await schedule.ResolveAsync(marketScope, day.Date, cancellationToken).ConfigureAwait(false);
            if (baseVersion is null)
            {
                continue;
            }

            if (BaseWindow(baseVersion, day.Date).NoTrade)
            {
                continue; // база и так не торгует (выходной) — исключение не нужно
            }

            var note = $"ISS dailytable: {day.Date:dd.MM.yyyy} — нерабочий день (праздник/перенос), " +
                       $"база ожидает торги ({BaseWindow(baseVersion, day.Date)})";
            var exception = new MarketScheduleException(
                day.Date, market, null, null, null, "no_trade",
                null, null, "authoritative", sourceName, Resolved: false, note);
            await schedule.UpsertExceptionAsync(exception, cancellationToken).ConfigureAwait(false);
            flagged++;
        }

        if (flagged > 0)
        {
            logger.LogWarning(
                "Pre-flight календарь {Engine}: заведено {Count} no_trade-исключений (праздники в горизонте {Days} дн.)",
                engine, flagged, CalendarHorizonDays);
        }
        else
        {
            logger.LogInformation(
                "Pre-flight календарь {Engine}: праздников в торгующих по базе днях (горизонт {Days} дн.) не найдено",
                engine, CalendarHorizonDays);
        }
    }

    private async Task CompareAndFlagAsync(
        ScheduleScope scope, string subject, string sourceName, ConfirmerSchedule confirmed, DateOnly today,
        CancellationToken cancellationToken)
    {
        var baseVersion = await schedule.ResolveAsync(scope, today, cancellationToken).ConfigureAwait(false);
        if (baseVersion is null)
        {
            logger.LogInformation("Pre-flight {Subject}: базового расписания для рынка «{Market}» нет — сверка пропущена",
                subject, scope.Market);
            return;
        }

        var baseWindow = BaseWindow(baseVersion, today);
        var (open, close) = ScheduleWindow.Trading(confirmed, today);
        var confWindow = new Window(open, close);

        if (WindowsEqual(baseWindow, confWindow))
        {
            logger.LogInformation("Pre-flight {Subject} {Date}: расписание совпадает с базой ({Window}) — ок",
                subject, today, baseWindow);
            return;
        }

        var kind = confWindow.NoTrade ? "no_trade" : "shifted";
        var note = $"Auto pre-flight {subject}: база {baseWindow}, {sourceName} {confWindow}";
        var exception = new MarketScheduleException(
            today, scope.Market, scope.SecType, scope.Category, scope.Instrument, kind,
            confWindow.NoTrade ? null : confWindow.Open,
            confWindow.NoTrade ? null : confWindow.Close,
            "authoritative", sourceName, Resolved: false, note);

        await schedule.UpsertExceptionAsync(exception, cancellationToken).ConfigureAwait(false);
        logger.LogWarning("Pre-flight {Subject} {Date}: РАСХОЖДЕНИЕ — {Note}. Заведено исключение ({Kind})",
            subject, today, note, kind);
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

    /// <summary>Рынок (market) → движок ISS для session_schedule.</summary>
    private static string? EngineOf(string market) => market switch
    {
        "derivatives" => "futures",
        "stock" => "stock",
        "currency" => "currency",
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
