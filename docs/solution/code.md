# OHS — обзор кода (vertical slice)

Документ описывает проекты OHS (Online History Server): приём ленты сделок → нормализация →
пакетная запись в TimescaleDB (write-path) и control-plane (ASP.NET Core: REST + WebSocket,
управление записью и подключениями), а также **admin frontend** (React + RxJS, §7).
`Db.Migrator` описан в фазах Stage 0.

## Направление зависимостей

В центре — `Domain` (порты и каноническая модель), вокруг — адаптеры, которые эти
порты реализуют. Домен ни от кого не зависит; адаптеры зависят от домена.

```
Connectors.Transaq ─┐
                    ├─►  Domain (порты: IInstrumentStore, ITradeWriter, IMarketMessage)
Ingestion ──────────┤          ▲
                    │          │
Storage.Timescale ──┘──────────┘ (реализует порты)
```

## Конвейер данных (write-path)

```
TRANSAQ XML → Parser (ACL) → [Ingestion: Registry + Normalizer + Batcher] → Writer (COPY) → TimescaleDB
```

- **Connectors** — «получить и распарсить чужой формат».
- **Ingestion** — «привести к нашему канону, разрешить инструмент, накопить батч».
- **Storage** — «положить в БД».

## Соглашения по коду

- **Primary constructor + «убей своих любимцев» (YAGNI).** Параметр primary-конструктора
  используется напрямую, без дублирующего поля `_field`. Приватное поле заводим только
  когда это не голый проброс: трансформация (`_fragments = fragments.ToList()`) или
  собственное состояние (`_channel`, `_cache`, `_messages`).
- **Нейминг.** Интерфейсы — `I…`; типы/члены — `PascalCase`; приватные поля — `_camelCase`;
  аббревиатуры-не-акронимы — как слова (`TransaqSecId`, а не `TransaqSecID`).
- **Ключ инструмента** — пара `(Ticker, Board)` (`Ticker` — сокращённый код, TRANSAQ `seccode`),
  а не нестабильный между сессиями `secid`.

---

## 1. Scinverse.Ohs.Domain

Ядро: каноническая модель рынка, конвертация цены и **порты** (интерфейсы), которые
реализуют внешние адаптеры. Зависимостей на инфраструктуру нет.

### Модель

- `InstrumentKey` (`readonly record struct`) — стабильный ключ `(Ticker, Board)`.
  `Ticker` — сокращённый код инструмента (TRANSAQ `seccode`, напр. `SBER`, `RIU6`).
- `MarketSide` (`enum : short`) — сторона инициатора: `Buy = 1`, `Sell = -1`.
- `SecurityInfo : IMarketMessage` — справочная информация об инструменте (секция
  TRANSAQ `securities`): `Key`, `TransaqSecId`, `MarketId`, `ShortName`, `Name`,
  `SecType`, `Decimals`, `MinStep` (шаг цены — основа конвертации), `LotSize`,
  `PointCost`, `Currency`. **Атрибуты деривативов** (заполняются обогащением, phase 6c):
  `UnderlyingCode`, `UnderlyingFuturesCode`, `Expiration`, `OptionType`, `Strike`.
- `DerivativeSpec` + `IDerivativeSpecParser` — разбор атрибутов дериватива из кода инструмента;
  `MoexFortsSpecParser` понимает коды FORTS: фьючерс `SiU6` (буква месяца + год → `Expiration`
  = 3-я пятница) и опцион `SiU6C65000` (`OptionType`/`Strike` + ссылка на базовый фьючерс).
  Нераспознанный код → `false` (инструмент остаётся «плоским»).
- Каталог/группировка (read-model): `InstrumentQuery` (фильтры `q`/`board`/`secType`/
  `onlyRecording`/`underlyingCode`/`expiration` + `limit`/`offset`) → `InstrumentCatalogPage`
  (`Items` + `Total`); `GroupQuery` (`level = underlying|series`) → `InstrumentGroup`
  (ключ/экспирация + число контрактов) для лениво-иерархического дерева.
- `TradeEvent : IMarketMessage` — сделка из ленты `alltrades` **до** нормализации:
  `Key`, `TradeNo`, `Timestamp`, `Price` (в деньгах), `Quantity`, `Side`, `OpenInterest?`.
- `Instrument` — зарегистрированный инструмент со стабильным `InstrumentId` и параметрами
  цены. Несёт доменное поведение конвертации (шаг цены знает сам инструмент):
  - `ToTicks(decimal price)` → `long` — цена → ticks по `MinStep`;
  - `ToPrice(long ticks)` → `decimal` — обратно.
- `TradeRecord` — нормализованная сделка, готовая к записи в `md_trade`: `InstrumentId`
  + `SourceId` + `PriceTicks` (цена в «шагах»).
- `CoverageSegment` — сегмент записи (сессия) для `(InstrumentId, SourceId)`: `StartedAt`,
  `EndedAt?` (null = активна), `TradeCount`, `Status`.
- `ConnectorConnection` — подключение коннектора без секретов: `SourceId`, `Name`, `Kind`,
  `Settings` (JSON, только несекретное), `Enabled`.

### Конвертация цены

- `TickMath` (static) — единый источник математики:
  - `ToTicks(price, minStep)` = `round(price / minStep, AwayFromZero)`, валидирует `minStep > 0`;
  - `ToPrice(ticks, minStep)` = `ticks * minStep`.
- Fluent-обёртки живут на `Instrument` (не расширяют `decimal`/`long`, чтобы не
  засорять примитивы), а математика — в `TickMath` (тестируемо, единый источник правды).

### Порты (реализуются в Storage.Timescale)

- `IMarketMessage` — маркерный тип доменного сообщения.
- `IInstrumentStore` — хранилище справочника:
  - `LoadAllAsync` — загрузить все активные инструменты;
  - `UpsertAsync(SecurityInfo)` — идемпотентно сохранить market/board/instrument (+ строку
    `derivative`, если инструмент дериватив) и вернуть инструмент со стабильным `InstrumentId`;
  - `QueryAsync(InstrumentQuery)` — пагинированный каталог с фильтрами (`LEFT JOIN derivative`,
    `COUNT(*) OVER()` для `Total`);
  - `QueryGroupsAsync(GroupQuery)` — группы для дерева (уровни `underlying`/`series`).
- `ITradeWriter` — пакетная запись сделок; возвращает число фактически вставленных
  строк (после дедупликации).
- `ISourceStore` — резолвинг кода источника (`transaq`/`synthetic`/`qscalp`) в `source_id`.
- `ICoverageStore` — сегменты покрытия: `OpenAsync` (идемпотентно, если активный уже есть),
  `ExtendAsync` (heartbeat `trade_count`), `CloseAsync` (`ended_at` + статус).
- `IConnectionStore` — подключения коннекторов (без секретов): `List`/`Get`/`Upsert`(по имени)/
  `SetEnabled`.

> На будущее: `IInstrumentStore` заведомо прирастёт методами вроде
> `LoadInstrumentAsync(instrumentId, …)` — добавим по мере надобности.

---

## 2. Scinverse.Ohs.Connectors.Transaq

**Anti-Corruption Layer** к TRANSAQ: получает сырые XML-фрагменты, разбирает их в
доменные сообщения. Сырой поток развязан от конвейера через `Channel<string>`.

### Порты

- `IMarketConnector : IAsyncDisposable` — источник данных: `ConnectAsync`,
  `SubscribeTradesAsync(instruments)`, `DisconnectAsync`, `Messages` (`ChannelReader<string>`),
  `IsConnected`. Публикация сырого XML в канал развязывает нативный поток колбэка от
  обработки.
- `ITransaqParser` — `Parse(xml)` → `IEnumerable<IMarketMessage>`.

### Реализации

- `TransaqXmlParser : ITransaqParser` — разбирает корневые секции `alltrades` (→ `TradeEvent`)
  и `securities` (→ `SecurityInfo`); неизвестные корни игнорируются.
  - **Устойчивость к «грязным» данным:** все числа/время парсятся через `TryParse`
    (`TryInt/TryLong/TryShort/TryDecimal`, `TransaqTime.TryParse`). Битая запись
    **пропускается**, а не роняет ленивый `yield` у потребителя. Обязательные поля
    валидируются до создания события; некорректные необязательные становятся `null`/`0`.
  - `Name` пока `null` (в секции `securities` полного имени нет; приравнивать к
    `ShortName` некорректно).
- `TransaqConnector : IMarketConnector` — реальный коннектор через нативную
  `txmlconnector.dll` (P/Invoke, `stdcall`). Колбэк пишет XML в **unbounded** канал
  (нативный поток блокировать нельзя; backpressure держится на батчере). Делегат-колбэк
  хранится в поле, чтобы GC его не собрал. DLL-resolver статический (коннектор де-факто
  синглтон на процесс). Единственный класс со «классическим» конструктором: инициализатор
  поля `_callback = OnRawData` ссылается на инстанс-метод, недоступный без `this`.
- `FakeReplayConnector : IMarketConnector` — демо/тестовый: проигрывает заранее заданные
  XML-фрагменты без нативной DLL (e2e-прогон конвейера).

### Вспомогательное

- `TransaqTime` — разбор времени МСК (`dd.MM.yyyy HH:mm:ss[.fff]`, фиксированное `+03:00`;
  в РФ нет перехода на летнее время). `Parse` и безопасный `TryParse`.
- `TransaqConnectorOptions` — параметры подключения. **Креды (`Login`/`Password`) только
  через user-secrets / переменные окружения, не в `appsettings.json`.**

---

## 3. Scinverse.Ohs.Ingestion

Слой **нормализации и буферизации** между ACL-парсером и хранилищем: приводит события к
каноническому виду, разрешает инструмент и сглаживает скорость записи.

- `IInstrumentRegistry` / `InstrumentRegistry` — кэш-реестр `(Ticker, Board) → Instrument`
  на `ConcurrentDictionary` (потокобезопасно):
  - `InitializeAsync` — прогрев кэша из БД (`IInstrumentStore.LoadAllAsync`);
  - `RegisterAsync(SecurityInfo)` — **обогащает** справку деривативными атрибутами через
    `IDerivativeSpecParser`, затем идемпотентный upsert в БД + кэширование (получаем
    стабильный `InstrumentId` и `MinStep`);
  - `TryResolve(key, out instrument)` — быстрый lookup на горячем пути без БД.
- `TradeNormalizer` — `TryNormalize(TradeEvent, sourceId, out TradeRecord)`: переводит `TradeEvent`
  (цена в деньгах) в `TradeRecord` (`InstrumentId` + `SourceId` + `PriceTicks` через
  `instrument.ToTicks`). Сделки по незарегистрированному инструменту отбрасываются (`false`), а не
  роняют поток. `SourceId` резолвится из `IMarketConnector.SourceCode` через `ISourceStore`.
- `TradeBatcher` (+ `TradeBatcherOptions`) — буфер с backpressure:
  - продюсеры кладут `TradeRecord` в **ограниченный** `Channel` (`BoundedChannel`,
    `FullMode = Wait`) — при отставании писателя продюсер притормаживается;
  - фоновый `RunAsync` собирает батч **по размеру** (`BatchSize`) **или по таймауту**
    (`FlushInterval`) и отдаёт целиком в `ITradeWriter.WriteAsync`;
  - на завершении/закрытии канала дособирает и сбрасывает остаток.

---

## 4. Scinverse.Ohs.Storage.Timescale

**Адаптер хранилища**: реализация выходных портов домена поверх PostgreSQL/TimescaleDB
(Npgsql + Dapper).

### 4.1. `InstrumentStore : IInstrumentStore` — справочник инструментов

Работа с таблицами `instrument`, `market`, `board`.

- `LoadAllAsync` — грузит активные инструменты (Dapper, маппинг колонок в `InstrumentRow`
  по `AS`-алиасам, затем `Map` → доменный `Instrument`).
- `UpsertAsync(SecurityInfo)` — идемпотентно, в одной транзакции:
  1. `INSERT … ON CONFLICT DO NOTHING` в `market` и `board` (гарантируем FK-родителей);
  2. `INSERT … ON CONFLICT (ticker, board_id) DO UPDATE … RETURNING` в `instrument` —
     сразу получаем сгенерированный `instrument_id`;
  3. если справка — дериватив (`UnderlyingCode` + `Expiration`), upsert строки `derivative`
     (`underlying_id` резолвится best-effort по коду базового фьючерса);
  4. возвращает доменный `Instrument`.
- `QueryAsync(InstrumentQuery)` — параметризованный каталог: `LEFT JOIN derivative`, склейка
  `WHERE` (`ILIKE` по поиску, `EXISTS` для `onlyRecording`, фильтры `underlyingCode`/`expiration`),
  `COUNT(*) OVER()` для `Total`, `ORDER BY` + `LIMIT/OFFSET`.
- `QueryGroupsAsync(GroupQuery)` — группировка каталога: `underlying` (`GROUP BY underlying_code`)
  или `series` (по `expiration` для заданного базового актива).
- `InstrumentRow` / `InstrumentCatalogRow` / `InstrumentGroupRow` — приватные DTO для Dapper
  (snake_case ↔ свойства через алиасы).
- `DateOnlyTypeHandler` — Dapper-хендлер `DateOnly` ↔ PostgreSQL `date` (в тип-карте Dapper
  `DateOnly` отсутствует); регистрируется в статическом конструкторе `InstrumentStore`.
  Nullable-фильтр по дате в SQL кастуется явно (`@expiration::date`) — иначе Postgres не выведет
  тип параметра при `NULL`.

### 4.2. `TimescaleTradeWriter : ITradeWriter` — пакетная запись сделок

Горячий путь записи в hypertable `md_trade`. Паттерн **staging + COPY BINARY + dedup**,
всё в одной транзакции:

1. `CREATE TEMP TABLE _stage_trade … ON COMMIT DROP` — временная таблица на время транзакции.
2. `COPY _stage_trade FROM STDIN (FORMAT BINARY)` через `BeginBinaryImportAsync` — самый
   быстрый способ загрузки; поля пишутся типизированно (`NpgsqlDbType`), `OpenInterest` —
   nullable (`WriteNullAsync`).
3. `INSERT INTO md_trade SELECT … FROM _stage_trade ON CONFLICT (instrument_id, source_id,
   trade_no, ts) DO NOTHING` — переливка с **дедупликацией** по первичному ключу.
4. `Commit`; возвращает число фактически вставленных строк.

**Почему так:** `COPY` напрямую в целевую таблицу не умеет `ON CONFLICT`. Staging даёт и
скорость bulk-загрузки, и идемпотентность (повтор батча/пересечения по номерам сделок не
создают дублей).

### 4.3. `SourceStore` / `CoverageStore` / `ConnectionStore`

- `SourceStore : ISourceStore` — `SELECT source_id … WHERE code = @code` (Dapper); неизвестный
  источник → исключение.
- `CoverageStore : ICoverageStore` — `coverage_segment`: `Open` (SELECT активного → иначе INSERT
  RETURNING), `Extend` (`UPDATE … trade_count += @n WHERE ended_at IS NULL`, no-op при delta ≤ 0),
  `Close` (`UPDATE … ended_at, status`).
- `ConnectionStore : IConnectionStore` — `connector_connection`: List/Get, `Upsert` через
  `ON CONFLICT (name) DO UPDATE` (`settings::jsonb`), `SetEnabled`.

### Схема БД (миграции)

- `V001__reference.sql` — `market`, `board`, `instrument` (уникальный ключ `(ticker, board_id)`),
  расширение `timescaledb`.
- `V002__market_data_trades.sql` — `md_trade` как **hypertable** (партиции по `ts`, чанки по
  1 дню), PK `(instrument_id, trade_no, ts)`, индекс `(instrument_id, ts DESC)` под «последние
  сделки по инструменту». `side smallint` (+1/−1), `open_interest` nullable (FORTS),
  `ingest_ts` — время записи.
- `V003__derivative_and_risk.sql` — подтип `derivative` (1:1 с `instrument`) и темпоральная
  `instrument_risk` (см. `db-design.md`, Решение 2).
- `V004__data_source_and_source_id.sql` — справочник `data_source`; `md_trade.source_id`
  (бэкфилл `transaq`) в PK `(instrument_id, source_id, trade_no, ts)` (Решение 3).
- `V005__coverage_segment.sql` — `coverage_segment` (+ partial-unique активного сегмента).
- `V006__connector_connection.sql` — `connector_connection` (unique `name`, сид `synthetic-local`).
- `V007__derivative_grouping.sql` — `derivative.underlying_id` → nullable, `+ underlying_code TEXT`,
  индекс `ix_derivative_group (underlying_code, expiration)` под лениво-иерархический каталог.

### Интеграционные тесты

`Scinverse.Ohs.IntegrationTests` поднимает эфемерный TimescaleDB (Testcontainers,
запиненный образ), прогоняет реальные миграции (DbUp) и проверяет:
- `TimescaleTradeWriter` — запись+чтение, идемпотентность (дедуп по PK), сохранение нахлёста
  разных `source_id`, `NULL open_interest`, пустой батч;
- `CoverageStore` — идемпотентный `Open`, накопление `trade_count` через `Extend`, `Close`
  (`ended_at`+статус) и открытие нового сегмента после закрытия; торговые дни из `md_trade`
  (`QueryTradingDaysAsync`, фильтр выходных/лимит) и экстент покрытия (`QueryCoverageExtentAsync`),
  phase 7b;
- `DerivativeStore`/группировка — upsert цепочки FUT+OPT → строки `derivative` (+ резолв
  `underlying_id`), `QueryGroupsAsync(underlying|series)`, лист цепочки по `underlyingCode`.

Требует запущенный Docker.

## 5. Scinverse.Ohs.Contracts

Контракт REST API (без зависимостей на инфраструктуру), общий для сервера и клиентов.

- **DTO** — `InstrumentDto` (+ деривативные поля `underlyingCode`/`optionType`/`strike`/
  `expiration`), `InstrumentPageDto` (пагинация: `items`/`total`/`limit`/`offset`),
  `InstrumentGroupDto` (дерево), `SourceDto`, `CoverageSegmentDto` (+ `GapDto`), `RecordingDto`,
  `ConnectionDto`, `SessionDto`/`CoverageExtentDto` (phase 7b), запросы `InstrumentQueryParams`/
  `StartRecordingRequest`/`UpsertConnectionRequest`/`ConnectionCredentialsRequest`.
- **`IOhsApi`** — обычный интерфейс-контракт (HTTP-маршрут указан в XML-doc каждого метода).
  Сервер реализует те же маршруты на Minimal API; типизированный клиент — рукописный
  (`OhsApiClient` в API-тестах, `HttpClient` + `System.Net.Http.Json`). Согласованность держат
  API-тесты. Source-generator Refit убран: его генератор не грузится в хосте анализаторов Visual
  Studio (`System.Memory 4.0.0.0`), хотя CLI-сборка проходит.

## 6. Scinverse.Ohs.Host (control-plane, ASP.NET Core)

Композиционный корень (`WebApplication`, Minimal API): DI, конфиг (`appsettings.json` +
неверсионируемый `appsettings.Local.json`), Serilog request logging, Swagger в dev, CORS `admin-dev`,
`/healthz`, WebSocket `/ws`. Реестр инструментов прогревается до `app.Run()`. Запись больше не
стартует из статического конфига — только через API.

- `OhsWorker : BackgroundService` — держит батчер записи и heartbeat покрытия; на остановке хоста
  закрывает записи и подключения, сливает батчер.
- `CoverageTracker` — учёт покрытия по активным записям (ключ `InstrumentKey`): `OpenAsync`
  (открыть сегмент), `Track` (счётчик принятых сделок), `RunHeartbeatAsync` (сброс дельт в
  `Extend` + `coverageExtended` в `/ws`), `CloseAsync` (досброс + `Close`).
- `RecordingManager` — оркестратор записей (ключ instrumentId): `StartAsync(instrumentId, connectionId)`
  (резолв инструмента → `CoverageTracker.OpenAsync` → `SubscribeTradesAsync` на коннекторе подключения),
  `StopAsync` (unsubscribe → close), `List`. Разнесён с `CoverageTracker`, чтобы разорвать цикл
  зависимостей с `ConnectionManager`.
- `ConnectorSession` — живая сессия коннектора: pump-цикл `parse → normalize → batch → Track`.
- `ConnectionManager` — жизненный цикл подключений: `Connect` (фабрика → connect → сессия),
  `Disconnect`, `Test`, `GetStatus`, `GetConnector`; публикует `connectionStatusChanged`.
- `WebSocketBroadcaster` — fan-out live-событий (`LiveEvent`: recording/coverage/connection) по
  сокетам; на клиента — ограниченный канал с `DropOldest`.
- `OhsEndpoints` — маршруты `/api/*`: `instruments` (пагинация + фильтры, phase 7),
  `instruments/groups` (дерево деривативов, phase 6c), sources, coverage(+gaps),
  `sessions`/`coverage/extent` (таймфреймы, phase 7b), recordings,
  connections + connect/disconnect/test + credentials.

Коннекторный слой (в `Connectors.Transaq`): `IConnectorFactory`/`ConnectorFactory` (по `kind`),
`ICredentialStore`/`InMemoryCredentialStore` (секреты только в памяти), `SyntheticLiveConnector`
(стримит сделки во времени для «живых» колбасок), `UnsubscribeTradesAsync` в порту.

### API-тесты

`Scinverse.Ohs.ApiTests` поднимает реальный хост (`WebApplicationFactory<Program>` +
Testcontainers-БД) и бьёт рукописным клиентом `OhsApiClient` (реализация `IOhsApi`):
reference-данные без секретов, пагинация/поиск каталога, дерево `instruments/groups`, полный
цикл записи (connect → start → рост `trade_count` → stop → закрытый сегмент), `/ws` присылает
`coverageExtended`. **Гермётичность:** хост читает строку подключения в top-level `Program` до
применения конфигурации фабрики (и `appsettings.Local.json` имеет приоритет), поэтому фабрика
детерминированно **подменяет сам `NpgsqlDataSource`** (`ConfigureTestServices`) на контейнер —
тесты не зависят от dev-БД. Требует Docker.

## 7. Admin frontend (`web/`, React + TS + Vite + RxJS)

Админ-панель управления записью и панель покрытия (Гант). Архитектура — **framework-agnostic ядро
(`core/`) + тонкий React-слой (`ui/`)**; тема тёмная (вдохновлено `scrider-editor`). Тесты — Vitest.

### `core/` — доменное ядро на RxJS (без React)

- `OhsStore.ts` — центральный стор (`BehaviorSubject`-ы: инструменты/пагинация, дерево деривативов,
  источники/подключения/записи, `coverage$`, `window$`, `timeframe$`/`sessions$`). REST-команды
  дергают API и правят сабджекты; live-события из `/ws` инкрементально двигают колбаски.
  Таймфрейм → окно: `D/W` (последние сессии), `M/Q/Y` (сдвиг + торговые дни), `All` (экстент),
  `range` (произвольный) — все посессionные.
- `api.ts` — RxJS-клиент REST (`getInstruments`, `getInstrumentSeries`, `getSessions`,
  `getCoverage`, `getCoverageExtent`, connect/record/…); `live.ts` — WS-поток `LiveEvent`.
- `types.ts` — зеркало DTO контракта + фронт-типы (`Timeframe`, `SessionDto`, `CoverageExtentDto`).
- `moexSession.ts` — часы сессий MOEX (будни 08:50–23:50, выходной 09:50–19:00) и генерация
  календарных сессий (`recentSessions`, `sessionsFrom`).
- `sessionProjection.ts` — **посессионная проекция оси**: доля ∝ длительности сессии, разрывы
  схлопнуты в шов; без сессий — линейная шкала.
- `sourceColors.ts` (цвет = источник), `exchange.ts` (борд → биржа).

### `ui/` — React-слой

- `context.ts` + хуки `useObservable`/`useBehavior` (подписка на сабджекты), `useNow` (тик для
  «ползущих» колбасок), `useVirtualRows` (виртуализация + infinite scroll), `useDebouncedValue`,
  `useElementWidth` (ResizeObserver — адаптивная плотность оси).
- Компоненты: `InstrumentPicker` (дерево инструментов + дорожки + footer), `CoverageTrack`
  (колбаски/гэпы/слоты выходных на div-ах, тултипы-даты через нативный `title`), `TimeAxis`
  (адаптивная ось: засечки + подписи, плотность по ширине), `TimeframePanel` + `DateRangePicker`
  (панель таймфреймов), `CategoryDropdown`/`FilterBar` (фильтры каталога), `Button`, `StatusDot`,
  `ThemeToggle`.
- Страницы: `ProviderCard` (карточка провайдера), `ConnectionsPanel` (управление подключениями).

Проверки фронта: `pnpm exec tsc --noEmit`, `pnpm exec eslint`, `pnpm exec vitest run`
(`OhsStore.test.ts`, `sessionProjection.test.ts`).
