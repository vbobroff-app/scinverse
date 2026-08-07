# catalog-basket-instruments / life-cycle — apply (as-is)

**Часть фичи:** текущая реализация Lifecycle / Refresh / post-dump basket sync.  
Индекс — [`../main.md`](../main.md). To-be — [spec.md](spec.md).  
Каталог baskets / Observed — [`../catalog/apply.md`](../catalog/apply.md).

**Статус:** as-is сверка с кодом (2026-08-07).  
Archive + immediate re-eval + **post-dump basket sync** (idle) +
NC (**Lifecycle** суточный / **Checkup** на Refresh) +
**durable гейт суток в БД** — **DONE**.  
Dynamic ATM в sweep — **нет**.

Продуктовая сводка: [`wiki-readme/catalog.md`](../../../wiki-readme/catalog.md).

---

## 1. Что реализовано сейчас

| Контур | Состояние |
|--------|-----------|
| Правило Online / upsert `active` | DONE |
| Суточный sweep на первом connect checkup-суток (≥04:00 МСК) | DONE |
| Durable гейт checkup/post-dump в БД (`ohs_runtime_state`, V033) | DONE |
| Force sweep из Refresh | DONE |
| Archive → Evict → Auto off → Stop | DONE |
| Немедленный re-eval static + rebuild Observed в sweep | DONE |
| `registry.Invalidate(false)` после sweep (разрешить dump persist) | DONE |
| **Post-dump basket sync** (idle 3 с после Available persist, 1×/день / force) | DONE |
| NC Lifecycle на суточном авто-sweep | DONE |
| NC Checkup (актуальность) + Action (кэш) на Refresh | DONE |
| NC post-dump продолжение той же lifecycle/checkup-нити | DONE |
| Dynamic ATM в sweep | **нет** |

---

## 2. Конвейер

```text
TrySweepAsync(force)
    → (если !force) load/claim checkup day из ohs_runtime_state
    → ArchiveExpired
    → Evict / Auto off / Stop (если есть archived)
    → ReEvalAll + RebuildCache          # снять expired из members сразу
    → registry.Invalidate(false)        # ждать сегодняшний dump
    → PublishDailyLifecycle             # только !force → groupKind lifecycle

Available persist (miss-flush / PersistQueue batch)
    → OnAvailablePersisted()            # debounce idle 3 с
        → TrySyncBasketsAfterDumpAsync  # claim post-dump day → re-eval + rebuild + NC

MarkFresh после Refresh (pending cache-corr)
    → TrySyncBasketsAfterDumpAsync(force: true)
```

Зачем два re-eval: sweep до dump убирает просроченных; post-dump подхватывает
**новые** тикеры месяца из свежего Available (после Observed cutover dump почти весь —
miss path, не PersistQueue).

---

## 3. Триггеры

| Событие | Что |
|---------|-----|
| Первый успешный connect checkup-суток (≥04:00 МСК) | `TrySweep(false)` + NC **Lifecycle** |
| Connect 00:30 (хвост сессии) | тот же checkup-день, что утро вчера — sweep **не** повторяется |
| Старт Host | только `RebuildCache` Observed — **без** sweep |
| Рестарт Host в те же checkup-сутки | Auto-connect **не** повторяет Lifecycle (якорь в БД) |
| `POST …/catalog/refresh` | Invalidate force + OPT reset + `TrySweep(true)` + NC **Action** + **Checkup** |
| Miss-flush / PersistQueue upsert | `OnAvailablePersisted` → idle sync |
| MarkFresh закрыл Refresh cache-corr | force post-dump sync |

**Checkup day:** `InstrumentLifecycle.CheckupDayMoscow` — cutover `04:00` МСК (хардкод interim).  
Archive по экспирации по-прежнему на **календарную** дату (`TodayMoscow`).  
После [`../schedule/`](../schedule/spec.md) cutover = OpenTime единого окна.

---

## 3.1 Durable гейт «раз в сутки» (канон as-is)

**Почему БД:** память процесса после рестарта пуста. Auto-connect снова зовёт
`TrySweep(false)` — без durable якоря суточный Lifecycle и post-dump повторялись бы
каждый рестарт Host. «Раз в checkup-сутки» = **только** checkpoint в PostgreSQL.

| Элемент | As-is |
|---------|--------|
| Миграция | `db/migrations/V033__ohs_runtime_state.sql` |
| Таблица | `ohs_runtime_state (key TEXT PK, value TEXT, updated_at timestamptz)` |
| API | `IRuntimeStateStore` / `RuntimeStateStore` (DI в Host) |
| Checkup key | `catalog.checkup.last_day` → `yyyy-MM-dd` |
| Post-dump key | `catalog.baskets.post_dump.last_day` → `yyyy-MM-dd` |
| Сервис | `InstrumentLifecycleService` — hydrate → compare → **claim (Set)** → work |
| In-memory `_lastSweepDay` / `_lastPostDumpBasketDay` | кэш после hydrate; **не** SoT |
| `force` (Refresh / MarkFresh) | гейт частоты не блокирует; checkpoint всё равно обновляется |

Поведение:

1. `!force`: прочитать ключ из БД (если память ещё null) → если value == текущий checkup day → skip.
2. Иначе записать текущий checkup day в БД (**claim**), затем выполнить sweep / sync.
3. Новый процесс Host после рестарта видит claim → второй Auto-connect Lifecycle не открывает.

Тест: `TrySweep_skips_after_restart_when_checkup_day_persisted`
(`InstrumentLifecycleBasketSyncTests`).

Канон продукта — [spec.md §2.1](spec.md).

---

## 4. NC (одна нить = весь конвейер)

Ось `groupKind` (канон [`nc/threads`](../../nc/threads/spec.md)):
**периодичность → Lifecycle**, **разовая health-проверка → Checkup**
(например force Refresh, check-health); мутация — слабый признак.

| Corr | groupKind | Когда | Шаги |
|------|-----------|-------|------|
| `…cache:{runId}` | action | Refresh | invalidate → OPT reset → wait dump → fresh |
| `…lifecycle:{runId}` | lifecycle | суточный connect-sweep | archive → убрать expired → wait dump → **дописать новые** → done |
| `…checkup:{runId}` | checkup | Refresh (разовая актуализация) | тот же конвейер актуальности (без Action-кэша) |
| `…baskets:{runId}` | checkup | sync без предшествующего sweep | короткая разовая сверка наборов |

Post-dump **продолжает** lifecycle/checkup (не отдельная нить). Нить после sweep —
`underway` на «ожидание справочника», `resolved` после дозаписи новых тикеров.

Сообщения с дельтой members:
- `…baskets_expired`: «из наборов убрано ({n}) просроченных»; при n>0 в `data.items` —
  `{ basket, label, instrumentId }`;
- `…baskets_new`: «добавлено ({n}) инструментов…»; при n>0 — те же `items`.

---

## 5. Якоря в коде

| Слой | Файлы |
|------|--------|
| Sweep / post-dump | `InstrumentLifecycleService.cs` |
| Durable гейт | `V033__ohs_runtime_state.sql` · `IRuntimeStateStore` · `RuntimeStateStore` · keys выше |
| NC | `CatalogRefreshNc.cs` |
| Miss → signal | `ConnectorSession` → `onAvailablePersisted` |
| Queue → signal | `InstrumentCatalogPersistWriter` |
| Connect | `ConnectionManager` (sweep + callback) |
| Tests | `CatalogRefreshNcTests`, `InstrumentLifecycleBasketSyncTests` (+ restart gate) |

---

## 6. Gaps

| Тема | Статус |
|------|--------|
| Dynamic в Refresh | после v1 |
| Mid-day auto re-eval без dump/Refresh | out of scope |
| Host up через полночь без connect | checkup на первом connect после ≥04:00 МСК |
| Multi-Host claim / distributed lock | out of scope (один Host) |
