# catalog-basket-instruments / catalog — plan (v1)

**Статус:** PLAN (2026-08-06) · **C0 DONE**. Спека — [spec.md](spec.md) · as-is — [apply.md](apply.md) ·
индекс фичи — [`../main.md`](../main.md).

Цель v1: **ограничить Observed-кэш и основной список** — static baskets + system `recording`;
модалка конструктора набора; Available остаётся в БД, не в hot-cache списка записи.

---

## 1. Scope v1 / не v1

| В v1 | Не в v1 |
|------|---------|
| `kind=static` + glob (`ticker`, `*` `?` `[0-9]`, OR-массив) | `dynamic` ATM |
| system `recording` (запись on ∨ Auto), default ☑ | system `has_data` — в UI **disabled «скоро»**, предикат не реализуем |
| per-connection baskets + галки на сервере | seed Si/RTS/SBRF |
| материализация `basket_member`, re-eval на Lifecycle/Refresh / OK модалки | mid-day auto re-eval без Refresh |
| Observed-кэш = union ☑; `GET /instruments` из Observed | NC baskets emit (отдельная часть `nc-integration`) |
| модалка Available \| Match \| спека (read-only, без Start/Auto) | schedule-часть фичи |
| filter chips 7d поверх Observed | live bid/ask в 3-й колонке (T7 минимум из БД) |

Пустой старт: нет пользовательских baskets → в списке только ☑ Recording (текущие Auto/запись).

---

## 2. Схема БД (черновик T5 → миграция ~V032)

Имена уточняемы в apply миграции; смысл фиксируем здесь.

```text
instrument_basket
  basket_id        PK
  connection_id    FK → connector_connection  -- per-connection
  kind             text  CHECK (static | dynamic | system)
  name             text  -- UX для static/dynamic; для system = стабильный id
  system_id        text  NULL  -- 'recording' | 'has_data' | … UNIQUE (connection_id, system_id)
  enabled          bool  -- галка ☑ в union Observed
  created_at / updated_at

basket_rule          -- только static (v1); dynamic later
  basket_id        FK
  patterns         text[]  -- OR glob'ов по ticker
  sec_type         text NULL
  board_id         text NULL
  -- underlying later if needed

basket_member        -- материализованный снимок static
  basket_id        FK
  instrument_id    FK → instrument
  PRIMARY KEY (basket_id, instrument_id)
```

**System rows:** при первом обращении к connection — ensure `recording` (enabled=true).
Членство `recording` **не** обязано жить в `basket_member` — live из
`RecordingManager` / schedule Auto; в Observed-union подмешиваем в Host.

**Available** по-прежнему `instrument` (`active=true`); отдельные basket-таблицы — только
рабочие наборы.

---

## 3. Контуры кода

```text
Available (БД instrument active)
    ↑ dump / Lifecycle archive          (as-is)
    │
Static rules → eval/re-eval → basket_member
    │
Observed union (☑ baskets + live recording)
    → InstrumentRegistry cache (только Observed)
    → GET /api/instruments (+ chips 7d)
```

| Компонент | Задача v1 |
|-----------|-----------|
| Glob engine | `*` `?` `[…]`, ignore-case, OR-массив; unit-тесты на `RTS-*.2[0-9]`, `Si-*.*` |
| `IBasketStore` | CRUD basket/rules, enabled, load members, replace members after eval |
| `BasketEvalService` | Available ∩ rules → members; re-eval all static per connection |
| `ObservedCatalog` / registry | Init/rebuild из members ☑ + recording; dump Observe мержит только Observed keys |
| Lifecycle / Refresh | после archive (+ invalidate): re-eval static → rebuild Observed |
| API | baskets CRUD, preview match, patch enabled; instruments list = Observed |
| Web | фильтр «Наборы»; модалка 3 колонки; список без dump |

**Cutover:** после v1 `LoadAllAsync` / init registry **не** грузит весь `active` — только Observed.
Суточный dump (тысячи бумаг) остаётся **под капотом**: upsert Available в БД, в `_cache` —
только Observed. Пользователь этого «не замечает»; выигрыш — быстрые фильтры, reconnect,
дозагрузка по клику и список записи по узкому working set.

---

## 4. API (черновик)

| Метод | Смысл |
|-------|--------|
| `GET /api/connections/{id}/baskets` | список (static + system), `enabled` |
| `POST …/baskets` | создать static (name, patterns, sec_type?, board?) → eval → members |
| `PUT …/baskets/{basketId}` | правка правил → re-eval |
| `PATCH …/baskets/{basketId}` | `{ enabled }` — галка |
| `DELETE …/baskets/{basketId}` | только non-system |
| `POST …/baskets/preview` | Available ∩ rules → список (без persist) |
| `GET /api/instruments?connectionId=` | **только Observed** этой connection (обязательный scope) |

**Multi-connector:** какой connection connect'им — тот собирает свой dump → Available
(и membership) в своём контуре. Сейчас в UI часто один Finam, список выглядит «глобальным»;
v1 **закладываем явный `connectionId`** на instruments / baskets / preview / Observed-кэш
(не общий active на весь Host). Active connection в UI — удобный default query-параметра,
не замена scope.

**Available в модалке (v1):** `instrument.active` глобально — ок при одном Finam.
Резать Available «видимые этим connection» — later; baskets/Observed уже per-connection.

Спека инструмента в модалке: существующие поля DTO / `instrument`+`derivative` (T7 минимум).

---

## 5. Инкременты реализации

### C0 — Миграция + store — **DONE**

- `V032__instrument_basket.sql`: `instrument_basket` / `basket_rule` / `basket_member`
- `IBasketStore` + `BasketStore`: ensure system (`recording` on, `has_data` off), CRUD static,
  enabled, replace/list members, enabled-static union
- DI в Host; интеграция `BasketStoreTests` (4)

**Done:** миграция применяется; store читает/пишет baskets.

### C1 — Glob + eval

- Glob matcher + тесты
- `BasketEvalService`: preview + materialize `basket_member`
- хук: OK модалки / Refresh / суточный Lifecycle (после archive)

**Done:** re-eval снимает expired и добавляет новых матчей из Available.

### C2 — Observed-кэш cutover

- Registry init / rebuild из Observed union (☑ static members ∪ recording live)
- `Observe`/ApplyPersisted: в online-кэш только если instrument ∈ Observed (или станет после eval)
- `GET /instruments` ← Observed (пагинация/chips как сейчас, источник уже узкий)
- connect: без full static re-eval; crash → load members + recording

**Done:** при пустых static + Auto на N инструментах список = эти N; полный active не в registry.

### C3 — UI фильтр «Наборы» + модалка

- Чекбоксы наборов (persist `enabled`); system Recording всегда в списке
- Модалка: Available (ленивый query active) \| Match preview \| спека по клику
- Без Start/Auto в модалке; chips 7d остаются на основном списке
- Создание/правка/удаление static

**Done:** оператор собирает glob-набор → ☑ → инструменты в списке записи; Start только там.

### C4 — Refresh / Lifecycle wiring + регрессии

- Расширить catalog refresh: invalidate + archive + **re-eval static** + rebuild Observed
- Суточный sweep — тот же re-eval шаг
- Тесты: registry size; recording удерживает вне static; галка off убирает из списка (запись не стопается сама)
- `tsc` / eslint / `dotnet build` Host

**Done:** v1 закрыт по acceptance ниже.

---

## 6. Acceptance v1

1. Hot-cache / основной список ≠ весь `active`; без пользовательских baskets видны только recording/Auto.
2. Static basket: glob OR-массив + picker sec_type/board → member в БД → ☑ → в списке и кэше.
3. Lifecycle/Refresh: expired выпадают из members; новые тикеры по правилам появляются.
4. Connect не делает полный re-eval static; рестарт поднимает кэш из `basket_member` + recording.
5. Модалка без тумблеров записи; есть read-only спека; Start/Auto только в основном списке.
6. Chips 7d фильтруют Observed, не dump.
7. Список / baskets / preview всегда с `connectionId` (multi-connector ready).

---

## 7. Риски / открыто в реализации

| Тема | Заметка |
|------|---------|
| Dump vs узкий кэш | Cache miss на dump ≠ ошибка: upsert Available в БД, в `_cache` только Observed; dump раз в сутки / Refresh — ок под капотом |
| Shared `instrument` row across connections | PK инструмента глобальный; Observed/baskets — per-connection; один ticker может быть в разных union'ах |
| Ensure recording row | Идемпотентно при list baskets / connect |
| HasData checkbox | **DONE** — disabled «скоро»; предикат после v1 |
| Available modal scope | **DONE** — v1 глобальный `active`; per-connection Available later |
| NC | emit baskets внутри lifecycle — later (`nc-integration/`) |
| Баг `connected` vs waiting/active | Вне scope; см. [apply Поправка](apply.md) |

---

## 8. Порядок работ

`C0 → C1 → C2 → C3 → C4`

**Процесс:** после **каждого** инкремента `C*` — **стоп**, ревью, **коммит** (не сливать C0–C4 в один коммит).  
UI (C3) можно начинать после C1 preview API; с C2 — осторожно, без обхода стоп/коммит.

После v1 — отдельный plan на dynamic + `has_data` (не раздувать этот файл).
