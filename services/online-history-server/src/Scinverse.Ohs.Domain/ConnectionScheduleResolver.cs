namespace Scinverse.Ohs.Domain;

/// <summary>
/// Чистое разрешение расписания соединения (phase 7j v2).
///
/// Сессия принадлежит дню своего открытия: правило разрешается по дню открытия, окно
/// <c>[open, open+duration)</c> может уходить за полночь как хвост той же сессии. Чтобы понять,
/// нужно ли быть подключённым в момент <c>now</c>, проверяем дни открытия {вчера, сегодня}
/// (duration &lt; 24ч ⇒ дальше заглядывать незачем).
///
/// Победитель дня открытия: шаг 1 — наивысший присутствующий уровень (date &gt; dow &gt; main),
/// шаг 2 — свежесть (<see cref="ConnectionScheduleRule.EffectiveFrom"/> DESC) внутри уровня.
/// <c>mode=off</c> ⇒ сессии нет. <c>main</c> дополнительно гейтится торговым днём календаря;
/// исключения (dow/date) торговый день переопределяют.
/// </summary>
public static class ConnectionScheduleResolver
{
    /// <summary>Признак торгового дня ведущего календаря для <c>main</c>.</summary>
    public delegate bool TradingDayLookup(string engine, DateOnly openDay);

    /// <summary>Нужно ли быть подключённым в момент (<paramref name="localDate"/>, <paramref name="localTime"/>).</summary>
    public static bool IsConnectDesired(
        IReadOnlyCollection<ConnectionScheduleRule> liveRules,
        string engine,
        DateOnly localDate,
        TimeOnly localTime,
        TradingDayLookup isTradingDay)
    {
        foreach (var openDay in new[] { localDate.AddDays(-1), localDate })
        {
            if (ResolveSession(liveRules, engine, openDay, isTradingDay) is not { } session)
            {
                continue;
            }

            // Минуты now относительно полуночи дня открытия (localDate может быть тем же днём или на день позже).
            var nowMinutesFromOpen = (localDate.DayNumber - openDay.DayNumber) * 1440
                + (int)localTime.ToTimeSpan().TotalMinutes;
            var openMinutes = (int)session.Open.ToTimeSpan().TotalMinutes;

            if (nowMinutesFromOpen >= openMinutes && nowMinutesFromOpen < openMinutes + session.DurationMin)
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>Окно сессии дня открытия, либо null (нет правила / off / main в неторговый день).</summary>
    public static (TimeOnly Open, int DurationMin)? ResolveSession(
        IReadOnlyCollection<ConnectionScheduleRule> liveRules,
        string engine,
        DateOnly openDay,
        TradingDayLookup isTradingDay)
    {
        var winner = ResolveWinner(liveRules, openDay);
        if (winner is null || !winner.IsWindow)
        {
            return null;
        }

        if (winner.ScopeKind == ConnectionScheduleScopes.Main && !isTradingDay(engine, openDay))
        {
            return null;
        }

        return (winner.OpenTime!.Value, winner.DurationMin!.Value);
    }

    /// <summary>Победившее правило для дня открытия (уровень, затем свежесть). null — если ни одно не покрывает.</summary>
    public static ConnectionScheduleRule? ResolveWinner(
        IReadOnlyCollection<ConnectionScheduleRule> liveRules,
        DateOnly openDay)
    {
        ConnectionScheduleRule? best = null;
        var bestTier = -1;

        foreach (var rule in liveRules)
        {
            if (!Covers(rule, openDay))
            {
                continue;
            }

            var tier = ConnectionScheduleScopes.Tier(rule.ScopeKind);
            if (tier < bestTier)
            {
                continue;
            }

            if (tier > bestTier || best is null || rule.EffectiveFrom > best.EffectiveFrom)
            {
                bestTier = tier;
                best = rule;
            }
        }

        return best;
    }

    /// <summary>Покрывает ли скоуп правила данный день открытия.</summary>
    public static bool Covers(ConnectionScheduleRule rule, DateOnly openDay) => rule.ScopeKind switch
    {
        ConnectionScheduleScopes.Main => true,
        ConnectionScheduleScopes.Dow => rule.DowMask is { } mask && ConnectionScheduleDow.Contains(mask, openDay.DayOfWeek),
        ConnectionScheduleScopes.Date => rule.DateFrom is { } from && rule.DateTo is { } to
            && openDay >= from && openDay <= to,
        _ => false,
    };
}
