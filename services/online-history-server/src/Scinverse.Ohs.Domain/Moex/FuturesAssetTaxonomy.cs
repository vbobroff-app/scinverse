namespace Scinverse.Ohs.Domain.Moex;

/// <summary>
/// Таксономия классов базового актива фьючерсов MOEX FORTS (по спецификации «Группа контрактов» s205).
/// Чистая (без IO) логика классификации: сид-карта известных ASSETCODE + маппинг группы спот-актива ISS.
/// Используется рефрешем справочника (наполнение из ISS по кнопке).
/// </summary>
public static class FuturesAssetTaxonomy
{
    public const string Index = "index";
    public const string Shares = "shares";
    public const string Currency = "currency";
    public const string Rate = "rate";
    public const string Commodity = "commodity";
    public const string Other = "other";

    /// <summary>Русские названия категорий для UI (плашки/группировка).</summary>
    public static readonly IReadOnlyDictionary<string, string> CategoryTitles = new Dictionary<string, string>
    {
        [Index] = "Индексы",
        [Shares] = "Акции",
        [Currency] = "Валюта",
        [Rate] = "Процентные ставки",
        [Commodity] = "Товары",
        [Other] = "Прочее (на проверку)",
    };

    /// <summary>
    /// Сид-карта курируемого справочника: ASSETCODE → (категория, подкатегория, имя). Покрывает те коды,
    /// которые НЕ резолвятся через спот-актив ISS (валюта/ставки/товары/крипто-индексы и спец-индексы).
    /// Акции и обычные индексы, как правило, резолвятся автоматически по группе спот-инструмента.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, (string Category, string? Sub, string Title)> Seed =
        new Dictionary<string, (string, string?, string)>(StringComparer.OrdinalIgnoreCase)
        {
            // --- Валюта ---
            ["Si"] = (Currency, "fx", "Доллар США / рубль"),
            ["Eu"] = (Currency, "fx", "Евро / рубль"),
            ["ED"] = (Currency, "fx", "Евро / доллар США"),
            ["CNY"] = (Currency, "fx", "Китайский юань / рубль"),
            ["UCNY"] = (Currency, "fx", "Китайский юань / рубль"),
            ["GBPU"] = (Currency, "fx", "Фунт стерлингов / доллар США"),
            ["AUDU"] = (Currency, "fx", "Австралийский доллар / доллар США"),
            ["CHF"] = (Currency, "fx", "Швейцарский франк / рубль"),
            ["JPYU"] = (Currency, "fx", "Иена / доллар США"),
            ["TRY"] = (Currency, "fx", "Турецкая лира / рубль"),
            ["INR"] = (Currency, "fx", "Индийская рупия / рубль"),
            ["HKD"] = (Currency, "fx", "Гонконгский доллар / рубль"),
            ["KZT"] = (Currency, "fx", "Казахстанский тенге / рубль"),
            ["AED"] = (Currency, "fx", "Дирхам ОАЭ / рубль"),
            ["BYN"] = (Currency, "fx", "Белорусский рубль / рубль"),
            ["AMD"] = (Currency, "fx", "Армянский драм / рубль"),
            ["UUAH"] = (Currency, "fx", "Украинская гривна / рубль"),

            // --- Процентные ставки ---
            ["RUON"] = (Rate, null, "Ставка RUONIA"),
            ["MOEXREPO"] = (Rate, null, "Ставка RUSFAR"),
            ["1MFR"] = (Rate, null, "Ставка RUSFAR 1 месяц"),
            ["3MFR"] = (Rate, null, "Ставка RUSFAR 3 месяца"),

            // --- Индексы (в т.ч. крипто и спец, не резолвятся как акции) ---
            ["MIX"] = (Index, "equity", "Индекс МосБиржи"),
            ["MXI"] = (Index, "equity", "Индекс МосБиржи (мини)"),
            ["RTS"] = (Index, "equity", "Индекс РТС"),
            ["RTSM"] = (Index, "equity", "Индекс РТС (мини)"),
            ["IMOEX"] = (Index, "equity", "Индекс МосБиржи"),
            ["RGBI"] = (Index, "bonds", "Индекс гособлигаций RGBI"),
            ["RVI"] = (Index, "volatility", "Индекс волатильности RVI"),
            ["MOEXCN"] = (Index, "equity", "Индекс МосБиржи (юаневый)"),
            ["OGI"] = (Index, "sector", "Отраслевой индекс нефти и газа"),
            ["MMI"] = (Index, "sector", "Отраслевой индекс металлов и добычи"),
            ["FNI"] = (Index, "sector", "Отраслевой индекс финансов"),
            ["CNI"] = (Index, "sector", "Отраслевой индекс потребительского сектора"),
            ["BTC"] = (Index, "crypto", "Биткоин (индекс)"),
            ["ETH"] = (Index, "crypto", "Эфириум (индекс)"),
            ["SOL"] = (Index, "crypto", "Solana (индекс)"),
            ["XRP"] = (Index, "crypto", "XRP (индекс)"),
            ["TRX"] = (Index, "crypto", "TRON (индекс)"),
            ["BNB"] = (Index, "crypto", "BNB (индекс)"),

            // --- Товары ---
            ["BR"] = (Commodity, "oil", "Нефть Brent"),
            ["CL"] = (Commodity, "oil", "Нефть Light Sweet Crude Oil (WTI)"),
            ["NG"] = (Commodity, "gas", "Природный газ"),
            ["GOLD"] = (Commodity, "metals", "Золото"),
            ["GD"] = (Commodity, "metals", "Золото"),
            ["SILV"] = (Commodity, "metals", "Серебро"),
            ["SV"] = (Commodity, "metals", "Серебро"),
            ["PLT"] = (Commodity, "metals", "Платина"),
            ["PLD"] = (Commodity, "metals", "Палладий"),
            ["CU"] = (Commodity, "metals", "Медь"),
            ["ALMN"] = (Commodity, "metals", "Алюминий"),
            ["NICK"] = (Commodity, "metals", "Никель"),
            ["ZINC"] = (Commodity, "metals", "Цинк"),
            ["SUGAR"] = (Commodity, "agro", "Сахар"),
            ["SU"] = (Commodity, "agro", "Сахар"),
            ["WHEAT"] = (Commodity, "agro", "Пшеница"),
        };

    /// <summary>Классификация по сид-карте. Возвращает false, если ASSETCODE неизвестен.</summary>
    public static bool TryClassifySeed(string assetCode, out (string Category, string? Sub, string Title) hit)
        => Seed.TryGetValue(assetCode, out hit);

    /// <summary>
    /// Категория из поля <c>GROUPTYPE</c> («Группа контрактов») описания контракта ISS — авторитетный
    /// сигнал MOEX: Акции/Валюта/Индексы/Товары/Процентные ставки. Это основной путь классификации.
    /// </summary>
    public static string CategoryFromGroupType(string? groupType)
    {
        if (string.IsNullOrWhiteSpace(groupType))
        {
            return Other;
        }

        var g = groupType.Trim().ToLowerInvariant();
        if (g.Contains("акци", StringComparison.Ordinal))
        {
            return Shares;
        }

        if (g.Contains("валют", StringComparison.Ordinal))
        {
            return Currency;
        }

        if (g.Contains("индекс", StringComparison.Ordinal))
        {
            return Index;
        }

        if (g.Contains("товар", StringComparison.Ordinal))
        {
            return Commodity;
        }

        if (g.Contains("ставк", StringComparison.Ordinal) || g.Contains("процент", StringComparison.Ordinal))
        {
            return Rate;
        }

        return Other;
    }

    /// <summary>
    /// Маппинг «группы» спот-инструмента ISS (столбец group из /iss/securities) в категорию фьючерса.
    /// Примеры групп: stock_shares, stock_dr, stock_index, currency_selt, stock_bonds…
    /// </summary>
    public static string CategoryFromIssGroup(string? group)
    {
        if (string.IsNullOrWhiteSpace(group))
        {
            return Other;
        }

        var g = group.Trim().ToLowerInvariant();
        if (g.StartsWith("stock_index", StringComparison.Ordinal))
        {
            return Index;
        }

        if (g.StartsWith("stock_shares", StringComparison.Ordinal)
            || g.StartsWith("stock_dr", StringComparison.Ordinal))
        {
            return Shares;
        }

        if (g.StartsWith("currency", StringComparison.Ordinal))
        {
            return Currency;
        }

        return Other;
    }
}
