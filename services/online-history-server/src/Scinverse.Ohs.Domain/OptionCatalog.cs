namespace Scinverse.Ohs.Domain;

/// <summary>Семейство опционов (ответ <c>option_families</c>).</summary>
public sealed record OptionFamily(DateOnly Expiration, int? LotSize, string? FamilyCode);

/// <summary>Страйк из <c>family_strikes</c>.</summary>
public sealed record OptionStrikeQuote(decimal Strike, char? OptionType, string OptCode);

/// <summary>Фильтр ATM ± N уникальных страйков.</summary>
public static class AtmStrikeFilter
{
    /// <summary>
    /// Берёт уникальные цены страйков, ближайшие к <paramref name="atmPrice"/> в окне ±N,
    /// возвращает все <c>opt_code</c> (C+P) для выбранных страйков.
    /// </summary>
    public static IReadOnlyList<string> SelectOptCodes(
        IReadOnlyList<OptionStrikeQuote> strikes, decimal atmPrice, int depth)
    {
        if (strikes.Count == 0 || depth <= 0)
        {
            return [];
        }

        var byStrike = strikes
            .GroupBy(s => s.Strike)
            .OrderBy(g => g.Key)
            .ToList();

        if (byStrike.Count == 0)
        {
            return [];
        }

        var atmIndex = 0;
        var bestDist = decimal.MaxValue;
        for (var i = 0; i < byStrike.Count; i++)
        {
            var dist = Math.Abs(byStrike[i].Key - atmPrice);
            if (dist < bestDist)
            {
                bestDist = dist;
                atmIndex = i;
            }
        }

        var from = Math.Max(0, atmIndex - depth);
        var to = Math.Min(byStrike.Count - 1, atmIndex + depth);
        var codes = new List<string>();
        for (var i = from; i <= to; i++)
        {
            foreach (var q in byStrike[i])
            {
                if (!string.IsNullOrWhiteSpace(q.OptCode))
                {
                    codes.Add(q.OptCode.Trim());
                }
            }
        }

        return codes.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }
}

/// <summary>Итог ensure/load опционного окна.</summary>
public sealed record LoadOptionsResult(
    bool Loaded,
    bool SkippedFresh,
    int OptCodesRequested,
    int FamiliesFound,
    int StrikesFound,
    decimal? AtmPrice,
    string Message);
