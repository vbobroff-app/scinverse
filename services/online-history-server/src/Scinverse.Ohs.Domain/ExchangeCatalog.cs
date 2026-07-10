namespace Scinverse.Ohs.Domain;

/// <summary>
/// Резолвер «биржа → набор board_id». Зеркало клиентского <c>web/src/core/exchange.ts</c>.
/// Сейчас единственная биржа — MOEX, все борды в БД относятся к ней, поэтому фильтр по MOEX
/// фактически no-op (задел под площадки Finam: CME/LSE/… добавим сюда вместе с их бордами).
/// </summary>
public static class ExchangeCatalog
{
    /// <summary>Биржа по умолчанию для любого board без явного override.</summary>
    public const string DefaultExchange = "MOEX";

    /// <summary>Явные борды не-MOEX бирж (пока пусто; наполняется при появлении мультибиржи).</summary>
    private static readonly IReadOnlyDictionary<string, string> NonDefaultBoards =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Набор board_id для фильтра по выбранным биржам, либо <c>null</c> — без ограничения.
    /// Если среди выбранных есть MOEX (борды которой не перечислимы) — ограничения нет.
    /// Если выбраны только не-MOEX биржи — возвращаем их известные борды (пустой список ⇒
    /// ничего не совпадёт, что корректно: не-MOEX данных ещё нет).
    /// </summary>
    public static IReadOnlyList<string>? BoardsFilter(IReadOnlyList<string>? exchanges)
    {
        if (exchanges is null)
        {
            return null;
        }

        var selected = exchanges
            .Where(e => !string.IsNullOrWhiteSpace(e))
            .Select(e => e.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (selected.Count == 0 || selected.Contains(DefaultExchange))
        {
            return null;
        }

        return NonDefaultBoards
            .Where(kv => selected.Contains(kv.Value))
            .Select(kv => kv.Key)
            .ToList();
    }
}
