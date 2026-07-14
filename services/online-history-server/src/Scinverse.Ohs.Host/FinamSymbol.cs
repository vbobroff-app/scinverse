using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Строит символ Finam (<c>SECID@MIC</c>, напр. <c>SBER@MISX</c>, <c>SiU6@RTSX</c>) из ключа инструмента
/// <c>(ticker, board)</c>. SECID = ticker (совпадает с seccode TRANSAQ), MIC выводится из TRANSAQ-board.
/// Маппинг намеренно узкий и явный: для незнакомого board возвращаем null (pre-flight пропустит запрос,
/// а не сформирует мусорный символ). Расширяем по мере добавления рынков.
/// </summary>
internal static class FinamSymbol
{
    private static readonly Dictionary<string, string> BoardToMic = new(StringComparer.OrdinalIgnoreCase)
    {
        ["FUT"] = "RTSX",   // FORTS фьючерсы
        ["OPT"] = "RTSX",   // FORTS опционы
        ["TQBR"] = "MISX",  // фондовый рынок (акции)
    };

    /// <summary>Символ Finam для ключа инструмента или null, если MIC для board неизвестен.</summary>
    public static string? TryBuild(InstrumentKey key) =>
        BoardToMic.TryGetValue(key.Board, out var mic) ? $"{key.Ticker}@{mic}" : null;
}
