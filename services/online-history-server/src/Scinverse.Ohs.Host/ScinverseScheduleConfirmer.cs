using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Domain.Schedule;
using Scinverse.Ohs.Host.Finam;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Композитный «умный» источник расписания (adapter <c>scinverse</c>) — фасад над Finam и MOEX ISS,
/// который сам выбирает провайдера под запрос (cross-source). В UI появляется отдельной интеграцией:
/// на неё ставится эксклюзивная галка <c>use_for_schedule</c>, и pre-flight/эндпоинты работают без
/// изменений (резолвятся по adapter через реестр). См. docs/dev/phase7i/schedule.md.
///
/// Роутинг по capability/движку:
/// <list type="bullet">
/// <item>Календарь (праздники/переносы) — всегда ISS (единственный с dailytable).</item>
/// <item>Расписание <c>futures</c> — ISS (бесплатно, market-wide); при пустом/ошибке — Finam.</item>
/// <item>Расписание <c>stock</c>/<c>currency</c> — Finam (per-instrument; ISS session_schedule по ним
/// пуст); при недоступности — ISS.</item>
/// </list>
/// Секрет для Finam-ветки берётся из назначенного finam-сервиса (сам фасад секрета не требует).
/// Зависит от КОНКРЕТНЫХ адаптеров (не от реестра) — иначе цикл в DI (реестр → фасад → реестр).
/// </summary>
public sealed class ScinverseScheduleConfirmer(
    FinamScheduleConfirmer finam,
    IssScheduleConfirmer iss,
    IExternalServiceStore services) : IScheduleConfirmer, ICalendarConfirmer
{
    public string Adapter => "scinverse";

    public bool RequiresSecret => false;

    public IReadOnlyCollection<ConfirmerCapability> Capabilities { get; } =
        [ConfirmerCapability.Schedule, ConfirmerCapability.Calendar];

    public async Task<ConfirmerProbe> ProbeAsync(ConfirmerQuery query, CancellationToken cancellationToken)
    {
        var issProbe = await iss.ProbeAsync(query, cancellationToken).ConfigureAwait(false);
        var finamQuery = await BuildFinamQueryAsync(query, cancellationToken).ConfigureAwait(false);
        var finamNote = finamQuery is null
            ? "не настроен (stock/currency — деградация на ISS)"
            : (await finam.ProbeAsync(finamQuery, cancellationToken).ConfigureAwait(false)).Message;

        // Здоровье фасада определяет ISS (календарь + futures всегда через него); Finam — доп. контекст.
        return new ConfirmerProbe(issProbe.Ok, $"ISS: {issProbe.Message}; Finam: {finamNote}");
    }

    public async Task<ConfirmerSchedule> GetScheduleAsync(ConfirmerQuery query, CancellationToken cancellationToken)
    {
        var raw = await GetRawScheduleAsync(query, cancellationToken).ConfigureAwait(false);
        // На выходе фасада времена приводятся к нашему канону (см. NormalizeToHouseFormat).
        return NormalizeToHouseFormat(raw);
    }

    /// <summary>Сырое расписание провайдера (до нормализации в наш формат): выбор источника + резерв.</summary>
    private async Task<ConfirmerSchedule> GetRawScheduleAsync(ConfirmerQuery query, CancellationToken cancellationToken)
    {
        var engine = (query.Engine ?? "futures").Trim().ToLowerInvariant();
        var finamFirst = engine is "stock" or "currency";

        // Основной провайдер + резерв (cross-source): пустой ответ/ошибка → пробуем второй.
        if (finamFirst)
        {
            return await TryFinamAsync(query, cancellationToken).ConfigureAwait(false)
                   ?? await iss.GetScheduleAsync(query, cancellationToken).ConfigureAwait(false);
        }

        return await TryIssScheduleAsync(query, cancellationToken).ConfigureAwait(false)
               ?? await TryFinamAsync(query, cancellationToken).ConfigureAwait(false)
               ?? new ConfirmerSchedule(engine, []);
    }

    /// <summary>
    /// Приведение времён источника к нашему канону — полуинтервал <c>[start, end)</c> в целых минутах.
    /// Внешние источники (ISS, Finam) отдают инклюзивный «конец» на секунде <c>:59</c> (напр. фаза
    /// заканчивается <c>09:59:59</c> = «до 10:00»). Мы: <b>Start → floor до минуты</b>, <b>End → ceil до
    /// минуты</b>. Тогда <c>09:59:59 → 10:00</c>, <c>18:59:59 → 19:00</c>, а конец суток <c>23:59:59 → 00:00</c>
    /// (следующие сутки). Времена, уже кратные минуте, не меняются.
    /// </summary>
    private static ConfirmerSchedule NormalizeToHouseFormat(ConfirmerSchedule raw)
    {
        var sessions = raw.Sessions
            .Select(s => s with { Start = FloorToMinute(s.Start), End = CeilToMinute(s.End) })
            .ToList();
        return raw with { Sessions = sessions };
    }

    private static DateTimeOffset FloorToMinute(DateTimeOffset t) =>
        t.AddTicks(-(t.Ticks % TimeSpan.TicksPerMinute));

    private static DateTimeOffset CeilToMinute(DateTimeOffset t)
    {
        var rem = t.Ticks % TimeSpan.TicksPerMinute;
        return rem == 0 ? t : t.AddTicks(TimeSpan.TicksPerMinute - rem);
    }

    /// <summary>
    /// Собственный эндпоинт календаря фасада: композиционная логика «какие данные откуда брать» живёт
    /// ЗДЕСЬ, а не сводится к проксированию. Сейчас единственный источник дней (праздники/переносы/часы) —
    /// ISS <c>dailytable</c>; фасад собирает итог сам, по дням, оставляя точку расширения под cross-source
    /// правила (напр. часть полей из Finam, когда он их отдаст) — при этом контракт наружу не меняется.
    /// </summary>
    public async Task<ConfirmerCalendar> GetCalendarAsync(
        string engine, DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        // Базовый слой: календарь ISS (праздники/переносы/внешние часы дня).
        var issCalendar = await iss.GetCalendarAsync(engine, from, to, cancellationToken).ConfigureAwait(false);

        var days = new List<ConfirmerCalendarDay>(issCalendar.Days.Count);
        foreach (var issDay in issCalendar.Days)
        {
            days.Add(ComposeCalendarDay(engine, issDay));
        }

        return new ConfirmerCalendar(engine, days);
    }

    /// <summary>
    /// Композиция дня календаря из доступных источников. Точка, куда добавляются cross-source правила:
    /// «это поле — из ISS; если &lt;условие&gt; — уточнить из Finam/другого источника». Пока источник один
    /// (ISS), поэтому день возвращается как есть — но развилка уже здесь, а не в вызывающем коде.
    /// </summary>
    private static ConfirmerCalendarDay ComposeCalendarDay(string engine, ConfirmerCalendarDay issDay)
    {
        // ISS — базовый и пока единственный источник календаря. Часы дня приводим к нашему канону:
        // Open → floor до минуты, Close → ceil до минуты (инклюзивный :59 источника → стык минуты;
        // 23:59:59 → 00:00). TimeOnly.Add сам заворачивает конец суток за полночь.
        var day = issDay with { Open = FloorToMinute(issDay.Open), Close = CeilToMinute(issDay.Close) };

        // TODO(cross-source): правила уточнения по условию, напр.:
        //   if (ShouldRefineHours(engine, day)) day = day with { Open = finamOpen, Close = finamClose };
        //   if (IsSpecialMarketDay(engine, day.Date)) day = day with { IsTradingDay = false };

        return day;
    }

    private static TimeOnly? FloorToMinute(TimeOnly? t) =>
        t is { } v ? v.Add(TimeSpan.FromTicks(-(v.Ticks % TimeSpan.TicksPerMinute))) : t;

    private static TimeOnly? CeilToMinute(TimeOnly? t)
    {
        if (t is not { } v)
        {
            return t;
        }

        var rem = v.Ticks % TimeSpan.TicksPerMinute;
        return rem == 0 ? v : v.Add(TimeSpan.FromTicks(TimeSpan.TicksPerMinute - rem));
    }

    /// <summary>ISS-расписание или null, если пусто/ошибка (тогда пробуем Finam).</summary>
    private async Task<ConfirmerSchedule?> TryIssScheduleAsync(ConfirmerQuery query, CancellationToken ct)
    {
        try
        {
            var schedule = await iss.GetScheduleAsync(query, ct).ConfigureAwait(false);
            return schedule.Sessions.Count > 0 ? schedule : null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return null;
        }
    }

    /// <summary>Finam-расписание или null, если Finam не настроен/нет символа/пусто/ошибка.</summary>
    private async Task<ConfirmerSchedule?> TryFinamAsync(ConfirmerQuery query, CancellationToken ct)
    {
        var finamQuery = await BuildFinamQueryAsync(query, ct).ConfigureAwait(false);
        if (finamQuery is null || string.IsNullOrWhiteSpace(finamQuery.Symbol))
        {
            return null;
        }

        try
        {
            var schedule = await finam.GetScheduleAsync(finamQuery, ct).ConfigureAwait(false);
            return schedule.Sessions.Count > 0 ? schedule : null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return null;
        }
    }

    /// <summary>Запрос к Finam с секретом назначенного finam-сервиса; null — сервиса/секрета нет.</summary>
    private async Task<ConfirmerQuery?> BuildFinamQueryAsync(ConfirmerQuery query, CancellationToken ct)
    {
        var all = await services.ListAsync(ct).ConfigureAwait(false);
        var finamService = all.FirstOrDefault(s =>
            string.Equals(s.Adapter, "finam", StringComparison.OrdinalIgnoreCase) && s.Enabled);
        if (finamService is null)
        {
            return null;
        }

        var secret = await services.GetSecretAsync(finamService.ServiceId, ct).ConfigureAwait(false);
        return string.IsNullOrWhiteSpace(secret) ? null : query with { Secret = secret };
    }
}
