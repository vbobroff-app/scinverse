# Phase 7d. Особенности реализации

Конкретные решения фазы 7d. Обзор — в [plan.md](plan.md), статус — в [report.md](report.md).

## 1. Backend: расширение `InstrumentQuery` (Domain)

Добавляем три необязательных фильтра к `InstrumentQuery` (`Scinverse.Ohs.Domain/InstrumentCatalog.cs`):

```csharp
/// <summary>Только инструменты, по которым есть хоть один сегмент записи (есть данные).</summary>
public bool NonEmpty { get; init; }

/// <summary>Явный список инструментов (для фильтра «Выделенные»); null/пусто — без фильтра.</summary>
public IReadOnlyList<long>? InstrumentIds { get; init; }

/// <summary>Биржи (коды: MOEX, …). Маппятся на набор board_id; null/пусто — без фильтра.</summary>
public IReadOnlyList<string>? Exchanges { get; init; }
```

## 2. Backend: SQL-фильтры (`InstrumentStore.QueryAsync`)

Добавляем предикаты в `whereClause` (сохраняя приём `COUNT(*) OVER()` до LIMIT):

```sql
AND (NOT @nonEmpty OR EXISTS (
      SELECT 1 FROM coverage_segment cs WHERE cs.instrument_id = i.instrument_id))
AND (@instrumentIds IS NULL OR i.instrument_id = ANY(@instrumentIds))
AND (@boards IS NULL OR i.board_id = ANY(@boards))
```

Параметры: `nonEmpty` (bool), `instrumentIds` (`long[]?` — `null`, если список пуст, чтобы предикат
отключался), `boards` (`string[]?`). `@boards` — результат резолвера бирж (см. §3). Пустые массивы
нормализуем в `null` (иначе `= ANY('{}')` даст пустую выборку).

- **`NonEmpty`** трактуем как «был хоть один сегмент записи» (`coverage_segment` существует),
  а не `trade_count>0` — сегмент создаётся при старте записи и означает наличие данных/истории.
- **`InstrumentIds`** — единственный источник фильтра «Выделенные»; сервер не знает о клиентском
  выделении, поэтому фронт передаёт актуальный список id.

## 3. Backend: резолвер бирж (`ExchangeBoards`)

Сервер не хранит колонку «биржа». Резолвер `exchange code → board_id[]` — зеркало клиентского
`web/src/core/exchange.ts`. Пока единственная биржа MOEX, и **все борды в БД — MOEX**, поэтому:

- если выбранные биржи включают все известные (только MOEX) → `boards = null` (фильтр off);
- задел: при появлении не-MOEX бордов резолвер вернёт объединение бордов выбранных бирж.

Для v1 достаточно статической карты `NON_MOEX` (пустая) + «всё остальное = MOEX», как на клиенте.
Фактически фильтр «Биржи» сейчас no-op, но плумбинг end-to-end готов.

## 4. API (`OhsEndpoints` + `IOhsApi` + `Dtos`)

`GET /api/instruments` получает новые query-параметры. Списочные — принимаем и как повторяющиеся
(`?exchanges=MOEX&exchanges=…`), и как CSV (`?instrumentIds=1,2,3`) для компактности URL:

```csharp
api.MapGet("/instruments", async (
    string? q, string? board, string? secType, string? category, bool? onlyRecording,
    bool? nonEmpty, string? instrumentIds, string? exchanges,
    long? underlyingId, DateOnly? expiration, int? limit, int? offset,
    IInstrumentStore store, CancellationToken ct) => { … });
```

`instrumentIds`/`exchanges` парсим хелпером `ParseCsv` (split по `,`, trim, отбросить пустые).
Контракт `IOhsApi.GetInstrumentsAsync` и тестовый `OhsApiClient` получают те же необязательные
аргументы (дефолт — прежнее поведение, обратная совместимость api-тестов).

## 5. Frontend core: модель активных фильтров (`OhsStore`)

```ts
export type FilterKey = 'instruments' | 'selection' | 'exchanges';
export type SelectionCondition = 'recording' | 'nonEmpty' | 'selected';
```

- `activeFilters$: BehaviorSubject<FilterKey[]>` — порядок плашек (по добавлению). Дефолт — `[]`
  (стартуем без плашек; каталог = все инструменты). Прежний дефолт `category:'futures'` снимаем.
- `instrumentQuery$` расширяем: `nonEmpty?`, `instrumentIds?: number[]`, `exchanges?: string[]`.
- Методы:
  - `addFilter(key)` / `removeFilter(key)` — правят `activeFilters$`; `removeFilter` также очищает
    относящиеся к плашке поля запроса (напр. убрали «Инструменты» → `category = undefined`).
  - `clearFilters()` — `activeFilters$ = []` + сброс всех фильтр-полей (поиск не трогаем).
  - `setCategory(id)` — `category`.
  - `setSelectionConditions({recording, nonEmpty, selected})` — маппит в `onlyRecording`,
    `nonEmpty`, и `instrumentIds` (из `selectedInstruments$`, если `selected`).
  - `setExchanges(codes)` — `exchanges`.
- «Выделенные»: при активном условии `selected` в запрос кладём `instrumentIds` = текущее
  `selectedInstruments$`. Меняется выделение → пере-применяем фильтр (пере-fetch), пока плашка «Выбор»
  с условием `selected` активна.

## 6. Frontend api.ts

`buildInstrumentsQuery` дописывает:

```ts
if (params.nonEmpty) search.set('nonEmpty', 'true');
if (params.instrumentIds?.length) search.set('instrumentIds', params.instrumentIds.join(','));
if (params.exchanges?.length) search.set('exchanges', params.exchanges.join(','));
```

## 7. Frontend UI

- **`FilterPopover`** — примитив: якорится к плашке, закрывается по клику вне / Esc, рендер через
  портал в `body` (чтобы не обрезался `overflow` шапки). Тёмная тема.
- **`FilterChips`** — ряд активных плашек (`activeFilters$`) + `[+]` (меню-список фильтров с галочкой
  у добавленных) + `[×]` (сброс всех, disabled если пусто). Плашка: подпись = имя (+ значение через
  `filterLabel`), клик по телу → соответствующий поповер, `×` → `removeFilter`.
  - `CategoryFilterMenu` — радио-список категорий (`Все/Фьючерсы/Акции/Валюта/Облигации/Индексы`).
  - `SelectionFilterMenu` — чекбоксы `Запущенные / Не пустые / Выделенные`.
  - `ExchangeFilterMenu` — чекбоксы бирж (пока `MOEX`).
- **`FilterBar`** (рефактор): `[FilterChips]` слева, растяжка, `[Search]` справа. Поле поиска короче
  (`max-width`), с иконкой-лупой (inline SVG/символ) внутри. `CategoryDropdown` и чекбокс «только
  запущенные» из ряда удаляются (роль перешла в плашки). «Найдено: N» остаётся (у поиска или строкой).
- Мёртвый CSS `hint` из `ProviderCard.module.css` удаляем (подсказку убрали в этой же фазе).

## 8. Тесты

- **unit backend** (`FakeInstrumentStore` в `OhsApiTests` или `InstrumentStoreTests`): `nonEmpty`,
  `instrumentIds`, `exchanges` сужают выборку и `Total`.
- **api-тест**: новые query-параметры доходят до стора (проверка через фейк/споку).
- **vitest** `OhsStore`: `addFilter/removeFilter/clearFilters` меняют `activeFilters$`;
  `setSelectionConditions` маппит в `onlyRecording/nonEmpty/instrumentIds`; смена выделения при
  активном `selected` триггерит пере-fetch.
