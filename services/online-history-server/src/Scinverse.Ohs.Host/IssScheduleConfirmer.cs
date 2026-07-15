using Scinverse.Ohs.Domain.Moex;
using Scinverse.Ohs.Domain.Schedule;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Адаптер подтверждателя расписания поверх бесплатного MOEX ISS (<c>session_schedule</c> движка).
/// Публичный (без секрета), market-wide, только ТЕКУЩИЙ день. Маппит типы фаз ISS в нейтральный
/// <see cref="ScheduleSessionKind"/>. См. docs/dev/phase7c/apply.md §3 и phase7i/schedule.md.
/// </summary>
public sealed class IssScheduleConfirmer(IExchangeCatalog catalog) : IScheduleConfirmer, ICalendarConfirmer
{
    private const string DefaultEngine = "futures";

    public string Adapter => "moex-iss";

    public bool RequiresSecret => false;

    public IReadOnlyCollection<ConfirmerCapability> Capabilities { get; } =
        [ConfirmerCapability.Schedule, ConfirmerCapability.Calendar];

    public async Task<ConfirmerProbe> ProbeAsync(ConfirmerQuery query, CancellationToken cancellationToken)
    {
        var engine = string.IsNullOrWhiteSpace(query.Engine) ? DefaultEngine : query.Engine;
        try
        {
            var slots = await catalog.GetSessionScheduleAsync(engine, cancellationToken).ConfigureAwait(false);
            return new ConfirmerProbe(true, $"ISS доступен, сессий: {slots.Count} (движок {engine})");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException)
        {
            return new ConfirmerProbe(false, ex.Message);
        }
    }

    public async Task<ConfirmerSchedule> GetScheduleAsync(ConfirmerQuery query, CancellationToken cancellationToken)
    {
        var engine = string.IsNullOrWhiteSpace(query.Engine) ? DefaultEngine : query.Engine;
        var slots = await catalog.GetSessionScheduleAsync(engine, cancellationToken).ConfigureAwait(false);

        var sessions = slots
            .Select(s => new ConfirmerSession(MapKind(s.Type), s.Type, s.Start, s.End ?? s.Start))
            .ToList();

        return new ConfirmerSchedule(engine, sessions);
    }

    public async Task<ConfirmerCalendar> GetCalendarAsync(
        string engine, DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        var eng = string.IsNullOrWhiteSpace(engine) ? DefaultEngine : engine;
        var calendar = await catalog.GetEngineCalendarAsync(eng, cancellationToken).ConfigureAwait(false);

        var days = new List<ConfirmerCalendarDay>();
        for (var date = from; date <= to; date = date.AddDays(1))
        {
            var d = calendar.Describe(date);
            days.Add(new ConfirmerCalendarDay(date, d.IsTrading, d.Exception, d.Open, d.Close));
        }

        return new ConfirmerCalendar(eng, days);
    }

    private static ScheduleSessionKind MapKind(string type) => type.ToLowerInvariant() switch
    {
        "oa_booking" or "oa_pricing" or "ca_booking" or "ca_pricing" => ScheduleSessionKind.Auction,
        "morning_session" or "main_session" or "evening_session" or "weekend_session" => ScheduleSessionKind.Trading,
        "settlement_session" => ScheduleSessionKind.Settlement,
        "clearing_session" => ScheduleSessionKind.Clearing,
        _ => ScheduleSessionKind.Unknown,
    };
}
