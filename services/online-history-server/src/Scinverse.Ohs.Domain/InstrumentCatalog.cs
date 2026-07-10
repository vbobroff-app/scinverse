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

    /// <summary>
    /// Категория верхнего уровня (Finam-стиль): <c>futures</c>|<c>shares</c>|<c>bonds</c>|
    /// <c>currency</c>|<c>index</c>|<c>options</c>. Маппится на набор sec_type.
    /// </summary>
    public string? Category { get; init; }

    /// <summary>Только инструменты с активной записью (coverage_segment.ended_at IS NULL).</summary>
    public bool OnlyRecording { get; init; }

    /// <summary>Фильтр опционов по базовому фьючерсу (derivative.underlying_id) — лист дерева.</summary>
    public long? UnderlyingId { get; init; }

    /// <summary>Фильтр по экспирации серии (derivative.expiration).</summary>
    public DateOnly? Expiration { get; init; }

    public int Limit { get; init; } = 100;
    public int Offset { get; init; }
}

/// <summary>Параметры запроса узлов дерева каталога (ленивая группировка серий под фьючерсом).</summary>
public sealed record GroupQuery
{
    /// <summary>Уровень группировки. Сейчас поддерживается <c>series</c> (серии опционов фьючерса).</summary>
    public required string Level { get; init; }

    /// <summary>Базовый фьючерс (derivative.underlying_id) — обязателен для level=series.</summary>
    public long? UnderlyingId { get; init; }
}

/// <summary>Узел дерева каталога: серия (экспирация) + число листьев (страйков).</summary>
public sealed record InstrumentGroup
{
    public required string Key { get; init; }
    public required string Label { get; init; }

    /// <summary>Нотификатор типа серии: <c>W1..W5</c>|<c>M1..M12</c>|<c>Q1..Q4</c>.</summary>
    public string? Badge { get; init; }

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
    public string? ShortName { get; init; }
    public string? Name { get; init; }
    public required decimal MinStep { get; init; }
    public short Decimals { get; init; }
    public bool Active { get; init; }

    /// <summary>Есть ли открытый сегмент записи по этому инструменту.</summary>
    public bool Recording { get; init; }

    /// <summary>У фьючерса есть опционы (можно раскрыть в дерево). Всегда false для не-фьючерсов.</summary>
    public bool HasOptions { get; init; }

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
