# catalog-basket-instruments / catalog — apply (as-is Online-каталог)

**Часть фичи:** as-is Online-каталог. Индекс — [`../main.md`](../main.md). To-be — [spec.md](spec.md).

**Статус:** описание **текущей** реализации Online-каталога OHS (DONE 2026-08-04+).  
Baskets / Observed / Available как working set — **ещё нет**.

Продуктовая сводка: [`wiki-readme/catalog.md`](../../../wiki-readme/catalog.md).  
Протокол OPT: [`tickers-options.md`](../../../tickers-options.md).  
Модель данных: [`architecture/db-design.md`](../../../architecture/db-design.md) (§ Online lifecycle + OPT).

---

## 1. Что реализовано сейчас

| Контур | Состояние |
|--------|-----------|
| Список Online = `instrument.active = true` | DONE |
| Архив по `derivative.expiration` (МСК), строки не удаляем | DONE |
| Connect-dump → in-memory registry + фоновый persist | DONE |
| OPT ATM ±N (families → strikes → get_options) | DONE |
| Freshness OPT-окна на сутки МСК | DONE |
| Refresh (invalidate dump + сброс OPT + force lifecycle) + NC | DONE |
| UI: expand FUT/серии, Refresh + confirm | DONE |
| Baskets / Observed / union наборов | **нет** (spec) |
| Intraday «торгуется» (`sec_status` / статус борда) | **нет** (7c.9 / 7c.SEC) |
| History / `includeArchived` в списке | later |

Сейчас hot-cache записи = **весь** Online-каталог (`active`), не отдельный Observed.

---

## 2. Две оси (реализована одна)

| Ось | Вопрос | Реализация |
|-----|--------|------------|
| **Lifecycle** | Контракт ещё актуален по exp? | `instrument.active` + sweep / upsert |
| **Intraday** | Торгуется прямо сейчас? | **не** реализовано (расписание/сессия/halt — отдельно) |

`active=false` = **архив** (просрочен). Ночной актуальный контракт остаётся `active=true`.

---

## 3. Карта компонентов

```text
Connect <securities>
    → ConnectorSession.PumpAsync
    → InstrumentRegistry.Observe (+ MoexFortsSpecParser → derivative fields)
    → InstrumentCatalogPersistQueue
    → InstrumentCatalogPersistWriter → InstrumentStore.UpsertBatchAsync
    → MarkFresh (+ CatalogRefreshNc.OnCatalogMarkedFresh)

Expand серии / POST load-options
    → OptionCatalogService.EnsureOptionsAsync
    → IOptionCatalogLoader (Transaq): families → strikes → ATM ±N → get_options
    → тот же pump/registry/upsert

Startup / connect / Refresh
    → InstrumentLifecycleService.TrySweepAsync
    → InstrumentStore.ArchiveExpiredAsync (+ Evict, Auto off, Stop recording)
```

Регистрация DI: `Program.cs` — `InstrumentRegistry`, `InstrumentLifecycleService`,
`OptionWindowFreshness`, `OptionCatalogService`, `CatalogRefreshNc`, hosted
`InstrumentCatalogPersistWriter`.

---

## 4. Lifecycle: активные vs просроченные

### 4.1 Правило

Домен: `InstrumentLifecycle.IsListedOnline(expiration, todayMsk)` —

- `expiration == null` → online;
- иначе online iff `expiration >= today` (календарный день **МСК**).

На upsert (`InstrumentStore.Upsert` / `UpsertBatchAsync`) поле `active` выставляется этим
правилом. Dump **не** воскрешает уже архивный контракт в online-кэш: в registry в `_cache`
попадают только `Active`.

### 4.2 Sweep

`InstrumentLifecycleService.TrySweepAsync(force)`:

1. Гейт: не чаще одного раза на календарный день МСК, кроме `force`.
2. `InstrumentStore.ArchiveExpiredAsync` — `UPDATE … SET active=FALSE` где
   `derivative.expiration < today AND active`.
3. Для архивированных id: `registry.Evict` → снять Auto → `Stop` открытой записи (best-effort).

**Когда вызывается:**

| Триггер | force |
|---------|-------|
| Старт Host (после `registry.InitializeAsync`) | false |
| Успешный connect (`ConnectionManager`) | false |
| `POST /instruments/catalog/refresh` | **true** |

### 4.3 Чтение и гейты записи

- `QueryAsync` / `LoadAllAsync` — жёстко `WHERE active = TRUE`.
- `QueryGroupsAsync` (серии) — `active` **и** `expiration >= today`.
- OPT в плоском списке по умолчанию скрыты, пока нет фильтра
  `underlyingId` / `secType=OPT` / `category=options`.
- Start записи: `RecordingManager` → `IsListedOnlineAsync` → отказ, если архив.
- Auto on: `PUT /recording/schedule` → 400, если не listed online.

Строки в БД **не удаляются** — архив для истории / будущей докачки.

---

## 5. Connect-dump и in-memory каталог

Цель: не блокировать путь до первых сделок полным per-row upsert (см.
[startup-latency](../../../dev/phase7h/startup-latency.md)).

| Часть | Поведение |
|-------|-----------|
| Init | `LoadAllAsync` (только active) → `MarkFresh()` |
| Observe | hit+fresh → no-op; hit+stale / miss → очередь persist; просроченный → не в online-кэш, в БД уйдёт `active=false` |
| Invalidate | `_stale=true`; без `force` — не чаще 1×/день МСК (в т.ч. при Auto on) |
| Persist | batch ≤500; idle ~3 с → `MarkFresh` + NC «кэш свежий» |
| Очередь | bounded 100k, DropOldest |

Полный `<securities>` приходит **при connect**. Invalidate сам dump не скачивает: при живой
сессии нужен **reconnect**, иначе dump — на следующем connect. Refresh UI это явно говорит.

Производные поля FORTS (`underlying`, expiration, strike, C/P) — `MoexFortsSpecParser` в
`Observe` / upsert в `derivative`.

---

## 6. Опционы FORTS — ATM ±N

Connect-dump **не** обязан содержать OPT. Online-путь:

```text
subscribe FUT
  → get_option_families
  → get_family_strikes (серия / mat_date)
  → ATM ± OptionAtmDepth (default 15, clamp 1–50)
  → get_options (opt_code из strikes)
  → securities в pump → upsert каталога
```

| Компонент | Роль |
|-----------|------|
| `OptionCatalogService` | `ListOptionFamiliesAsync`, `EnsureOptionsAsync` |
| `OptionWindowFreshness` | ключ `(connectionId, futuresId, expiration)` → день МСК; ортогонально dump-Invalidate |
| `AtmStrikeFilter` | страйки по цене; окно `[atm−N … atm+N]`; все C/P этих страйков |
| ATM цена | live trade FUT (wait `OptionAtmLiveWaitSeconds`, default 3 с) → fallback last `md_trade` |
| `IOptionCatalogLoader` | Transaq + Synthetic |

**API**

- `GET /api/connections/{id}/option-families?futuresInstrumentId=`
- `POST /api/connections/{id}/load-options` — `{ futuresInstrumentId, expiration, force }`

**UI** (`OhsStore`):

1. Раскрыть FUT — серии из `GET /instruments/groups?level=series`; если пусто и connected →
   `option-families` (можно expand FUT **без** `hasOptions` в БД).
2. Раскрыть серию → `ensureOptions` (`force: false`) → лист OPT
   (`underlyingId` + `expiration` + `secType=OPT`).
3. Сортировка страйков в SQL: `strike`, затем `option_type`, ticker, board.

Повторный expand в тот же день МСК обычно без полного reload (freshness окна).  
`InvalidateAll` окон — на force Refresh.

> Ensure перед Auto/записью серии в Host как обязательный шаг **не** вшит; живой путь —
> expand UI / ручной `load-options`.

---

## 7. Refresh справочника

### 7.1 API

`POST /api/instruments/catalog/refresh`:

1. `registry.Invalidate(force: true)`
2. `optionFreshness.InvalidateAll()`
3. `lifecycle.TrySweepAsync(force: true)`
4. `CatalogRefreshNc.PublishForceRefresh(…)` (в т.ч. флаг «сессия live»)
5. Ответ: `InstrumentCatalogRefreshResultDto(Invalidated, IsFresh)`

### 7.2 NC (два независимых Group)

`CatalogRefreshNc` · module `ohs.instruments`:

| Corr | `groupKind` | Смысл |
|------|-------------|--------|
| `instruments.catalog.cache:{runId}` | `action` | invalidate + сброс OPT + ожидание dump / MarkFresh |
| `instruments.catalog.lifecycle:{runId}` | `lifecycle` | sweep / archivedCount |

UI ярлыки **Action** / **Lifecycle** (не слово «Group»). Канон нитей —
[phase11/to-threads](../../../dev/phase11/to-threads.md).

Если сессия уже connected — в cache-стеке сообщение, что нужен reconnect для нового dump.

### 7.3 UI

`ProviderCard`: `[связь][Refresh][Settings]` → confirm (`catalogRefreshMessage(sessionLive)`) →
`OhsStore.refreshInstrumentCatalog` → refetch списка.

Авто-sweep без NC Group — раз в день МСК на старте Host / первом connect (checkup NC — later).

---

## 8. Read-model и админ-список

| API | Поведение |
|-----|-----------|
| `GET /api/instruments` | пагинация, фильтры 7d; всегда `active=TRUE` |
| `GET /api/instruments/groups` | underlying / series; online + `expiration >= today` |
| DTO | `active`, `hasOptions`, strike / type / expiration / underlyingId |

Навигация — **фильтры 7d** + expand FUT→серия→страйки (дерево UI descoped).  
«Старт на серию» — bulk по `underlyingId`/`expiration` в плоском списке.

---

## 9. БД (минимум)

| Поле | Роль |
|------|------|
| `instrument.active` | Online vs архив |
| `derivative.expiration` | критерий sweep / groups / IsListedOnline |
| `derivative.underlying_id`, `strike`, `option_type`, `underlying_code` | иерархия read-model + ATM |

Отдельных таблиц basket / member **нет**.

---

## 10. Граница со spec (baskets)

Текущий apply = слой «весь Online + архив + ленивый OPT». Спека [spec.md](spec.md) добавляет:

- Available (все `active`) ⊥ Observed (union baskets) ⊥ Archive;
- static / dynamic baskets, материализация членства, sticky ATM в Observed;
- Refresh расширяется re-eval baskets;
- Auto/Start только из Observed;
- connect hot-cache = Observed, не полный dump.

Пока этого нет — dump и registry держат полный Online-набор.

---

## 11. Якоря в коде

| Слой | Файлы |
|------|--------|
| Domain | `InstrumentLifecycle.cs`, `AtmStrikeFilter` (рядом с OPT) |
| Registry / persist | `InstrumentRegistry.cs`, `InstrumentCatalogPersistQueue`, `InstrumentCatalogPersistWriter.cs` |
| Store | `InstrumentStore.cs` (`Query` / `Upsert` / `ArchiveExpired` / `IsListedOnline`) |
| Lifecycle | `InstrumentLifecycleService.cs` |
| OPT | `OptionCatalogService.cs`, `OptionWindowFreshness.cs`, Transaq `IOptionCatalogLoader` |
| Refresh NC | `CatalogRefreshNc.cs` |
| API | `OhsEndpoints.cs` — catalog/refresh, option-families, load-options |
| Web | `OhsStore.ts` (expand / refresh), `ProviderCard.tsx`, `api.ts` |
| Options | `OhsOptions.OptionAtmDepth`, `OptionAtmLiveWaitSeconds` |

---

## Поправка

Сверка as-is с кодом (2026-08-06). Канон lifecycle / Refresh+NC / ATM API / «нет baskets»
выше держится; ниже — уточнения формулировок и известные нюансы hot path / UI.

#### Расхождения

| Тема | Как читается выше | Уточнение по коду |
|------|-------------------|-------------------|
| Dump vs Online-кэш | «dump / registry = полный Online» | TRANSAQ `<securities>` шире Online (в т.ч. просроченные). В `_cache` / `LoadAll` — только `active`. Hot-cache записи = **весь Online**, не «весь сырой dump» и не Observed. |
| Persist после Observe | Одна цепочка Queue → Writer | **Два пути:** hit+stale → `InstrumentCatalogPersistQueue` → Writer → idle `MarkFresh`; **miss** → `_missBuffer` → прямой `UpsertBatchAsync` (очередь не участвует). При `IsFresh` hit = no-op — обычный connect почти не трогает PersistQueue. |
| Просроченный на dump | «в БД уйдёт `active=false`» | Из online-кэша снимается всегда; persist (и смена `active` в БД) — если каталог **stale**. При fresh — до следующего sweep строка в БД может ещё числиться `active`. |
| Groups API | underlying / series | `QueryGroupsAsync` сейчас отдаёт **series** по `underlyingId`; `query.Level` в store не читается. |
| Lazy OPT с expand | families / `load-options` при connected | UI (`resolveOptionConnectionId`) ждёт `status === 'connected'`, а Host после connect отдаёт `waiting` / `active` / `degraded`. Из-за этого живой fallback `option-families` / `load-options` с expand может **не стартовать**; остаются серии/OPT уже в БД. Тесты мокают `'connected'`. |
| Порядок ATM | families → strikes → ±N | В `EnsureOptionsAsync` сначала subscribe + цена БА (live / `md_trade`), затем families → strikes → filter → `get_options`. |

Мелочи (не ломают канон): `OptionAtmLiveWaitSeconds` clamp 1–30; `MarkFresh` / NC «кэш свежий» — после idle PersistWriter при реальной работе очереди, не после каждого miss-flush.
