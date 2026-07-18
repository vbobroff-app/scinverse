namespace Scinverse.Ohs.Domain;

/// <summary>Проверка «сейчас внутри окна суток» (в т.ч. через полночь).</summary>
public static class ConnectionScheduleWindow
{
    /// <summary>
    /// Полуинтервал [start, end): при <paramref name="start"/> &lt;= <paramref name="end"/> — обычный день;
    /// иначе окно через полночь (например 06:00–01:00).
    /// </summary>
    public static bool Contains(TimeOnly now, TimeOnly start, TimeOnly end)
    {
        if (start <= end)
        {
            return now >= start && now < end;
        }

        return now >= start || now < end;
    }
}
