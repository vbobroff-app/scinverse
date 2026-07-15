using Scinverse.Ohs.Domain.Finam;
using Scinverse.Ohs.Domain.Schedule;

namespace Scinverse.Ohs.Host.Finam;

/// <summary>
/// Адаптер подтверждателя расписания поверх Finam Trade API (per-instrument, требует секрет → JWT).
/// Маппит типы сессий Finam в нейтральный <see cref="ScheduleSessionKind"/>. См. schedule.md.
/// </summary>
public sealed class FinamScheduleConfirmer(IFinamApi finam) : IScheduleConfirmer
{
    public string Adapter => "finam";

    public bool RequiresSecret => true;

    public IReadOnlyCollection<ConfirmerCapability> Capabilities { get; } = [ConfirmerCapability.Schedule];

    public async Task<ConfirmerProbe> ProbeAsync(ConfirmerQuery query, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(query.Secret))
        {
            return new ConfirmerProbe(false, "Секрет не задан");
        }

        try
        {
            await finam.AuthenticateAsync(query.Secret, cancellationToken).ConfigureAwait(false);
            return new ConfirmerProbe(true, "Аутентификация успешна");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException)
        {
            return new ConfirmerProbe(false, ex.Message);
        }
    }

    public async Task<ConfirmerSchedule> GetScheduleAsync(ConfirmerQuery query, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(query.Secret))
        {
            throw new InvalidOperationException("Секрет не задан для этой интеграции");
        }

        if (string.IsNullOrWhiteSpace(query.Symbol))
        {
            throw new InvalidOperationException("Не задан символ инструмента (SECID@MIC)");
        }

        var schedule = await finam.GetScheduleAsync(query.Secret, query.Symbol, cancellationToken).ConfigureAwait(false);
        var sessions = schedule.Sessions
            .Select(s => new ConfirmerSession(MapKind(s.Type), s.Type, s.Start, s.End))
            .ToList();

        return new ConfirmerSchedule(schedule.Symbol, sessions);
    }

    private static ScheduleSessionKind MapKind(string type) => type.ToUpperInvariant() switch
    {
        "EARLY_TRADING" or "CORE_TRADING" or "LATE_TRADING" => ScheduleSessionKind.Trading,
        "OPENING_AUCTION" or "CLOSING_AUCTION" => ScheduleSessionKind.Auction,
        "CLEARING" => ScheduleSessionKind.Clearing,
        "CLOSED" => ScheduleSessionKind.Closed,
        _ => ScheduleSessionKind.Unknown,
    };
}
