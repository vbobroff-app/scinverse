# catalog-basket-instruments / catalog — apply (as-is)

**Часть фичи:** Available ⊥ Observed ⊥ baskets UI. Индекс — [`../main.md`](../main.md).  
To-be — [spec.md](spec.md) · plan — [plan.md](plan.md).  
Lifecycle / Refresh — [`../life-cycle/apply.md`](../life-cycle/apply.md).

**Статус:** as-is сверка с кодом (2026-08-07).  
C0–C3 **DONE** (store, glob/eval, Observed cutover, UI «Наборы» + модалка).  
C4 wiring (re-eval в sweep) — уже в life-cycle; регрессии — хвост.

Продуктовая сводка: [`wiki-readme/catalog.md`](../../../wiki-readme/catalog.md).  
Модель данных: [`architecture/db-design.md`](../../../architecture/db-design.md).

---

## 1. Что реализовано сейчас

| Контур | Состояние |
|--------|-----------|
| Слои Available / Observed / Archive | DONE |
| `instrument_basket` / `basket_rule` / `basket_member` (V032) | DONE |
| System `recording` (☑ default) + `has_data` (☐ disabled «скоро») | DONE |
| Static glob по `short_name` (fallback `ticker`), OR-массив | DONE |
| Preview / Materialize / ReEval (Host) | DONE |
| Observed-кэш = union ☑ + live recording; `GET /instruments` из Observed | DONE |
| API baskets CRUD + preview + `GET /instruments/available` | DONE |
| UI фильтр «Наборы» + `BasketEditorModal` (Available \| Match \| спека) | DONE |
| DnD Available → Match (дописать short_name в glob) | DONE |
| Общий `FilterSearch` / `ClearButton` в модалке и FilterBar | DONE |
| Lifecycle archive + re-eval + rebuild | DONE → [life-cycle](../life-cycle/apply.md) |
| Dynamic ATM baskets | **нет** (после v1) |
| NC emit baskets | **нет** (`nc-integration/`) |

---

## 2. Три слоя (as-is)

| Слой | Где | Как |
|------|-----|-----|
| **Available** | БД `instrument.active=true` | dump / upsert; модалка `GET /instruments/available` |
| **Observed** | `IObservedInstrumentSet` + узкий `InstrumentRegistry` | union members ☑ static + live recording |
| **Archive** | `active=false` | sweep / upsert; не в Online-списке |

Hot-cache записи = **Observed**, не весь Online. Dump по-прежнему может быть широким:
upsert в Available; в `_cache` — только Observed keys (miss dump → Available в БД).

---

## 3. Карта компонентов

```text
V032 tables → BasketStore / IBasketStore
    → BasketEvalService (Match / Preview / Materialize / ReEval*)
    → ObservedInstrumentSet.RebuildAsync
    → InstrumentRegistry.ReloadObservedAsync

API baskets (per connectionId)
    → CRUD static + PATCH enabled + preview
    → Materialize + RebuildCache

UI
    FilterChips «Наборы» → OhsStore baskets / PATCH enabled
    BasketEditorModal → Available query + preview Match + spec column
    FilterSearch (debounce 300ms, fullWidth) + ClearButton
```

Lifecycle hooks (sweep → ReEvalAll → Rebuild) — не дублируем здесь:
[`../life-cycle/apply.md`](../life-cycle/apply.md).

---

## 4. БД

```text
instrument_basket   (connection_id, kind, name, system_id?, enabled, …)
basket_rule         (patterns text[], sec_type?, board_id?)  — static
basket_member       (basket_id, instrument_id)              — снимок static
```

- Ensure system rows при list / re-eval connection: `recording` enabled, `has_data` off.
- Членство `recording` **не** в `basket_member` — live из RecordingManager / schedule Auto.
- Available — по-прежнему строки `instrument` (`active`).

Миграция: `V032__instrument_basket.sql`.

---

## 5. Eval / Match

- Поле матча: **`short_name`** (MOEX `XXXX-M.YY`); пустой → `ticker`.
- Glob: `*` `?` `[0-9]`…, ignore-case, OR по массиву `patterns`.
- `sec_type` / `board_id` — опциональные фильтры правила (ключ инструмента `(ticker, board)`).
- UI picker board: stub `FUT`/`OPTS`/`ROPD`/`TQBR` + «Любой» — не ISS; канон board —
  [spec §3.2.1](spec.md).
- `TickerGlob.Compile` один раз на правило (без перекомпиляции на каждый инструмент).
- Preview: Available ∩ rules, без persist.
- Materialize: ReplaceMembers для одного basket.
- ReEvalConnection / ReEvalAll: все static connection(s) — вызывается из lifecycle и API.

---

## 6. Observed-кэш

| Операция | Поведение |
|----------|-----------|
| `RebuildAsync` | union enabled-static members + recording ids |
| `ReloadObservedAsync` | registry только Active ∩ Observed |
| Dump Observe | miss → upsert Available; в `_cache` только Observed |
| `GET /instruments?connectionId=` | страница из Observed (без id — union; empty → пусто) |
| Start/Stop / PATCH enabled / basket OK | `ObservedCatalogCoordinator.RebuildCacheAsync` |

Startup: только RebuildCache Observed. Суточный TrySweep — на первом connect; гейт суток
в `ohs_runtime_state` (V033) — см. [life-cycle](../life-cycle/apply.md) §3.1.

---

## 7. API (baskets / Available)

| Метод | Смысл |
|-------|--------|
| `GET /api/connections/{id}/baskets` | static + system, `enabled` |
| `POST …/baskets` | create static → materialize |
| `PUT …/baskets/{basketId}` | правка правил → materialize |
| `PATCH …/baskets/{basketId}` | `{ enabled }` |
| `DELETE …/baskets/{basketId}` | non-system |
| `POST …/baskets/preview` | Match без persist |
| `GET /api/instruments/available` | Online active (модалка), не Observed |
| `GET /api/instruments?connectionId=` | Observed |

---

## 8. UI

### 8.1 Фильтр «Наборы»

Плашка в FilterChips: галки → `PATCH enabled`; HasData disabled «скоро»;
управление / создание → `BasketEditorModal`.

### 8.2 Модалка

Три колонки: **Available** \| **Match** \| **спека** (read-only).

- Available: ленивый query + `FilterSearch` (debounce в компоненте).
- Match: preview по правилам; локальный `FilterSearch`; DnD из Available дописывает
  `short_name` в glob (dedupe); обратного DnD нет.
- Спека: поля из DTO / instrument+derivative; **без** Start/Auto.
- Create / edit / delete static; confirm delete через `ConfirmDialog` + `ClearButton`.
- Remount поиска: `key={…-open}` при открытии.

Общие UI: `FilterSearch`, `ClearButton`, `XIcon` — FilterBar и модалка / confirm.

### 8.3 Основной список

Только Observed; Start/Stop/Auto здесь. Chips 7d режут Observed, не dump.

---

## 9. Dump / OPT (кратко)

Connect-dump → registry Observe → persist Available (см. исторический контур Host).  
OPT ATM ±N — expand FUT/серии / `load-options`; freshness окон; force Refresh сбрасывает.

Нюанс UI: `resolveOptionConnectionId` ждёт `status === 'connected'`, а Host после connect
может отдавать `waiting` / `active` / `degraded` — живой fallback families с expand
может не стартовать (серии/OPT уже в БД остаются).

Полный lifecycle/Refresh NC — [life-cycle apply](../life-cycle/apply.md).

---

## 10. Якоря в коде

| Слой | Файлы |
|------|--------|
| Domain | `IBasketStore`, `BasketRule`, `BasketKind`, `AvailableInstrument`, `TickerGlob` |
| Store | `BasketStore.cs`, `InstrumentStore` (`ListAvailable` / Query) |
| Eval | `BasketEvalService.cs` |
| Observed | `ObservedInstrumentSet.cs`, `ObservedCatalogCoordinator.cs`, `InstrumentRegistry` |
| API | `OhsEndpoints.cs` — baskets, available, instruments |
| Web | `BasketEditorModal.tsx`, `FilterChips.tsx`, `FilterSearch.tsx`, `ClearButton.tsx`, `OhsStore.ts`, `api.ts` |
| Migration | `V032__instrument_basket.sql`; life-cycle gate — `V033__ohs_runtime_state.sql` |
| Tests | `BasketStoreTests`, `BasketEvalServiceTests`, `ObservedCacheTests`, glob unit |

---

## 11. Gaps vs spec

| Тема | As-is | Spec |
|------|-------|------|
| static + recording + модалка | DONE | v1 |
| Match на short_name | DONE | §3.2 |
| DnD Available→Match | DONE (удобство UI) | не блокировал канон |
| dynamic / has_data предикат | нет / UI disabled | v1.1+ |
| Available per-connection | глобальный active | later |
| NC baskets | нет | nc-integration |
