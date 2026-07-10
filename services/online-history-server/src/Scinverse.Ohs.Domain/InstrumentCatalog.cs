namespace Scinverse.Ohs.Domain;

/// <summary>Параметры выборки каталога инструментов (фильтры + пагинация).</summary>
public sealed record InstrumentQuery
{
    /// <summary>Поиск по тикеру/названию (подстрока, регистронезависимо).</summary>
    public string? Search { get; init; }

    /// <summary>Фильтр по режиму торгов (board_id).</summary>
    public string? Board { get; init; }

    /// <summary>Фильтр по типу инструмента (sec_type: SHARE/FUT/OPT/BOND/CURRENCY).</summary>
    public string? SecType { get; init; }

    /// <summary>Только инструменты с активной записью (coverage_segment.ended_at IS NULL).</summary>
    public bool OnlyRecording { get; init; }

    /// <summary>Фильтр по базовому активу дериватива (derivative.underlying_code).</summary>
    public string? UnderlyingCode { get; init; }

    /// <summary>Фильтр по экспирации серии (derivative.expiration).</summary>
    public DateOnly? Expiration { get; init; }

    public int Limit { get; init; } = 100;
    public int Offset { get; init; }
}

/// <summary>Параметры запроса узлов дерева каталога (ленивая группировка).</summary>
public sealed record GroupQuery
{
    /// <summary>Уровень группировки: <c>underlying</c> | <c>series</c>.</summary>
    public required string Level { get; init; }

    /// <summary>Базовый актив (обязателен для level=series).</summary>
    public string? UnderlyingCode { get; init; }

    public string? SecType { get; init; }
    public string? Search { get; init; }
}

/// <summary>Узел дерева каталога: базовый актив или серия (экспирация) + число листьев.</summary>
public sealed record InstrumentGroup
{
    public required string Key { get; init; }
    public required string Label { get; init; }
    public required int Count { get; init; }
    public DateOnly? Expiration { get; init; }
}

/// <summary>Элемент каталога инструментов для админки (read-model).</summary>
public sealed record InstrumentCatalogItem
{
    public required long InstrumentId { get; init; }
    public required string Ticker { get; init; }
    public required string Board { get; init; }
    public string? SecType { get; init; }
    public string? Name { get; init; }
    public required decimal MinStep { get; init; }
    public short Decimals { get; init; }
    public bool Active { get; init; }

    /// <summary>Есть ли открытый сегмент записи по этому инструменту.</summary>
    public bool Recording { get; init; }

    // Атрибуты дериватива (для подписи листьев дерева); null для не-деривативов.
    public decimal? Strike { get; init; }
    public char? OptionType { get; init; }
    public DateOnly? Expiration { get; init; }
}

/// <summary>Страница каталога инструментов: элементы + общее число под фильтром.</summary>
public sealed record InstrumentCatalogPage(
    IReadOnlyList<InstrumentCatalogItem> Items,
    int Total,
    int Limit,
    int Offset);
