namespace Scinverse.Ohs.Contracts;

/// <summary>Инструмент справочника.</summary>
public sealed record InstrumentDto(
    long InstrumentId,
    string Ticker,
    string Board,
    string? SecType,
    string? ShortName,
    string? Name,
    decimal MinStep,
    short Decimals,
    bool Active,
    bool Recording,
    bool HasOptions = false,
    decimal? Strike = null,
    string? OptionType = null,
    DateOnly? Expiration = null);

/// <summary>Узел дерева каталога: базовый актив или серия (экспирация).</summary>
public sealed record InstrumentGroupDto(
    string Key,
    string Label,
    int Count,
    DateOnly? Expiration = null,
    string? Badge = null);

/// <summary>Страница каталога инструментов: элементы + общее число под фильтром.</summary>
public sealed record InstrumentPageDto(
    IReadOnlyList<InstrumentDto> Items,
    int Total,
    int Limit,
    int Offset);

/// <summary>Параметры выборки каталога инструментов (query-string у GET /api/instruments).</summary>
public sealed record InstrumentQueryParams
{
    public string? Q { get; init; }
    public string? Board { get; init; }
    public string? SecType { get; init; }

    /// <summary>Категория верхнего уровня: futures|shares|bonds|currency|index|options.</summary>
    public string? Category { get; init; }

    public bool OnlyRecording { get; init; }

    /// <summary>Только инструменты, по которым есть хоть один сегмент записи («Не пустые»).</summary>
    public bool NonEmpty { get; init; }

    /// <summary>Явный список инструментов («Выделенные»); null/пусто — без фильтра.</summary>
    public IReadOnlyList<long>? InstrumentIds { get; init; }

    /// <summary>Биржи (коды: MOEX, …) — задел под мультибиржу; null/пусто — без фильтра.</summary>
    public IReadOnlyList<string>? Exchanges { get; init; }

    /// <summary>Базовый фьючерс (instrument_id) для выборки страйков-листьев дерева.</summary>
    public long? UnderlyingId { get; init; }

    public DateOnly? Expiration { get; init; }
    public int Limit { get; init; } = 100;
    public int Offset { get; init; }
}

/// <summary>Источник данных (data_source).</summary>
public sealed record SourceDto(short SourceId, string Code, string? Name);

/// <summary>Торговая сессия MOEX: дата и границы (со смещением +03:00 МСК).</summary>
public sealed record SessionDto(
    DateOnly Date,
    DateTimeOffset Start,
    DateTimeOffset End,
    bool Weekend);

/// <summary>Границы покрытия данными (для таймфрейма «All»); пустые, если сегментов нет.</summary>
public sealed record CoverageExtentDto(DateTimeOffset? From, DateTimeOffset? To);

/// <summary>Внутрисессионный разрыв данных (вычисляется из md_trade по порогу).</summary>
public sealed record GapDto(DateTimeOffset From, DateTimeOffset To);

/// <summary>Сегмент покрытия («колбаска») + вычисленные внутрисессионные дыры.</summary>
public sealed record CoverageSegmentDto(
    long SegmentId,
    long InstrumentId,
    short SourceId,
    DateTimeOffset From,
    DateTimeOffset? To,
    long TradeCount,
    string Status,
    IReadOnlyList<GapDto> Gaps);

/// <summary>
/// Присутствие сделок по бакетам (слой сделок на Ганте): старты непустых бакетов инструмента.
/// Качественно (есть/нет), без объёма. Разрыв = отсутствие бакета.
/// </summary>
public sealed record TradeActivityDto(long InstrumentId, IReadOnlyList<DateTimeOffset> Buckets);

/// <summary>Запрос присутствия сделок: окно + размер бакета + источник + список инструментов.</summary>
public sealed record TradeActivityRequest(
    DateTimeOffset From,
    DateTimeOffset To,
    int BucketSeconds,
    short SourceId,
    IReadOnlyList<long> InstrumentIds);

/// <summary>Активная запись.</summary>
public sealed record RecordingDto(
    long InstrumentId,
    string Ticker,
    string Board,
    short SourceId,
    long ConnectionId,
    long SegmentId,
    DateTimeOffset StartedAt,
    long TradeCount);

/// <summary>Запрос на старт записи.</summary>
public sealed record StartRecordingRequest(long InstrumentId, long ConnectionId);

/// <summary>Подключение коннектора (без секретов) + рантайм-статус.</summary>
public sealed record ConnectionDto(
    long ConnectionId,
    short SourceId,
    string Name,
    string Kind,
    string Settings,
    bool Enabled,
    string Status);

/// <summary>Создание/обновление подключения.</summary>
public sealed record UpsertConnectionRequest(
    short SourceId,
    string Name,
    string Kind,
    string Settings,
    bool Enabled);

/// <summary>Учётные данные подключения (write-only, в БД не сохраняются).</summary>
public sealed record ConnectionCredentialsRequest(string Login, string Password);

/// <summary>
/// Проверка настроек подключения без записи в БД: поднять коннектор из
/// <paramref name="Kind"/>+<paramref name="Settings"/>(+креды) и сразу закрыть.
/// </summary>
public sealed record ValidateConnectionRequest(string Kind, string Settings, string? Login, string? Password);

/// <summary>Результат проверки настроек подключения.</summary>
public sealed record ValidateConnectionResult(bool Ok, string? Message);

/// <summary>Движок (торговая система) биржи из MOEX ISS.</summary>
public sealed record EngineDto(string Name, string Title);

/// <summary>Рынок движка биржи.</summary>
public sealed record MarketDto(string Name, string Title);

/// <summary>Режим торгов (борд) рынка.</summary>
public sealed record BoardDto(string BoardId, string Title, bool IsTraded);

/// <summary>Торгуемый инструмент борда (статика ISS <c>securities</c>).</summary>
public sealed record IssSecurityDto(
    string SecId,
    string? ShortName,
    string? Name,
    decimal? MinStep,
    int? LotSize,
    short? Decimals,
    string? AssetCode,
    string? Expiration,
    string? SecType);

/// <summary>Класс базового актива фьючерса (справочник futures_asset_class) для группировки/фильтров.</summary>
public sealed record FuturesAssetClassDto(
    string AssetCode,
    string Category,
    string? Subcategory,
    string? Title,
    string Source,
    bool Confirmed);

/// <summary>Итог актуализации справочника классов из ISS: всего кодов, новых, не распознано.</summary>
public sealed record AssetClassRefreshResultDto(int Total, int Inserted, int Unresolved);

/// <summary>
/// День торгового календаря движка (бесплатный <c>/iss/engines/{engine}</c>): торговый ли день,
/// его вид и внешние часы (МСК). <c>Kind</c>: <c>regular</c>|<c>transfer</c>|<c>dsvd</c>|
/// <c>weekend</c>|<c>holiday</c>. <c>Open</c>/<c>Close</c> заполнены только у торгового дня.
/// </summary>
public sealed record CalendarDayDto(
    DateOnly Date,
    bool IsTrading,
    bool Weekend,
    bool Exception,
    string Kind,
    TimeOnly? Open,
    TimeOnly? Close);
