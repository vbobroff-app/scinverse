# OHS — обзор кода (vertical slice)

Документ описывает проекты первого вертикального среза OHS (Online History Server):
приём ленты сделок TRANSAQ → нормализация → пакетная запись в TimescaleDB. Здесь
разобраны только уже отревьюенные проекты; `Host` и `Db.Migrator` будут добавлены
по мере разбора.

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
  `PointCost`, `Currency`.
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
  - `UpsertAsync(SecurityInfo)` — идемпотентно сохранить market/board/instrument и
    вернуть инструмент со стабильным `InstrumentId`.
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
  - `RegisterAsync(SecurityInfo)` — идемпотентный upsert в БД + кэширование (получаем
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
  3. возвращает доменный `Instrument`.
- `InstrumentRow` — приватная DTO для Dapper (snake_case ↔ свойства через алиасы).

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

### Интеграционные тесты

`Scinverse.Ohs.IntegrationTests` поднимает эфемерный TimescaleDB (Testcontainers,
запиненный образ), прогоняет реальные миграции (DbUp) и проверяет:
- `TimescaleTradeWriter` — запись+чтение, идемпотентность (дедуп по PK), сохранение нахлёста
  разных `source_id`, `NULL open_interest`, пустой батч;
- `CoverageStore` — идемпотентный `Open`, накопление `trade_count` через `Extend`, `Close`
  (`ended_at`+статус) и открытие нового сегмента после закрытия.

Требует запущенный Docker.

## 5. Scinverse.Ohs.Host

Композиционный корень (Generic Host): DI, конфиг (`appsettings.json` + неверсионируемый
`appsettings.Local.json`), выбор коннектора (`Ohs:UseFakeConnector`).

- `OhsWorker : BackgroundService` — оркестратор write-path: `Initialize` реестра → резолв
  `source_id` → старт батчера → `Connect` → по каждому инструменту `RecordingManager.StartAsync`
  → heartbeat покрытия (2 с) → цикл `parse → normalize → batch → Track` → на остановке
  `StopAll("stopped")` + слив батчера.
- `RecordingManager` — управляет активными записями: подписка коннектора + сегмент покрытия на
  `InstrumentKey`. `StartAsync` (subscribe + `Open`), `Track` (счётчик принятых сделок),
  `RunHeartbeatAsync` (периодический сброс дельт в `Extend`), `StopAllAsync` (досброс + `Close`).
  Динамический старт/стоп из UI — Phase 6b.
