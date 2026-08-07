# catalog-basket-instruments / life-cycle — apply (as-is)

**Часть фичи:** текущая реализация Lifecycle / Refresh / post-dump basket sync.  
Индекс — [`../main.md`](../main.md). To-be — [spec.md](spec.md).  
Каталог baskets / Observed — [`../catalog/apply.md`](../catalog/apply.md).

**Статус:** as-is сверка с кодом (2026-08-07).  
Archive + immediate re-eval + **post-dump basket sync** (idle) + NC checkup / lifecycle baskets — **DONE**.  
Dynamic ATM в sweep — **нет**.

Продуктовая сводка: [`wiki-readme/catalog.md`](../../../wiki-readme/catalog.md).

---

## 1. Что реализовано сейчас

| Контур | Состояние |
|--------|-----------|
| Правило Online / upsert `active` | DONE |
| Суточный sweep на первом connect checkup-суток (≥06:00 МСК) | DONE |
| Force sweep из Refresh | DONE |
| Archive → Evict → Auto off → Stop | DONE |
| Немедленный re-eval static + rebuild Observed в sweep | DONE |
| `registry.Invalidate(false)` после sweep (разрешить dump persist) | DONE |
| **Post-dump basket sync** (idle 3 с после Available persist, 1×/день / force) | DONE |
| NC checkup на авто-sweep | DONE |
| NC lifecycle steps baskets/observed на Refresh | DONE |
| NC checkup post-dump baskets sync | DONE |
| Dynamic ATM в sweep | **нет** |

---

## 2. Конвейер

```text
TrySweepAsync(force)
    → ArchiveExpired
    → Evict / Auto off / Stop (если есть archived)
    → ReEvalAll + RebuildCache          # снять expired из members сразу
    → registry.Invalidate(false)        # ждать сегодняшний dump
    → PublishDailyCheckup               # только !force

Available persist (miss-flush / PersistQueue batch)
    → OnAvailablePersisted()            # debounce idle 3 с
        → TrySyncBasketsAfterDumpAsync  # re-eval + rebuild + NC baskets

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
| Первый успешный connect checkup-суток (≥06:00 МСК) | `TrySweep(false)` + checkup NC |
| Connect 00:30 (хвост сессии) | тот же checkup-день, что утренний 06:00 вчера — sweep **не** повторяется |
| Старт Host | только `RebuildCache` Observed — **без** sweep/checkup |
| `POST …/catalog/refresh` | Invalidate force + OPT reset + `TrySweep(true)` + NC Action/Lifecycle |

**Checkup day:** `InstrumentLifecycle.CheckupDayMoscow` — cutover `06:00` МСК (хардкод interim).  
Archive по экспирации по-прежнему на **календарную** дату (`TodayMoscow`).  
После [`../schedule/`](../schedule/spec.md) cutover = OpenTime единого окна.
| Miss-flush / PersistQueue upsert | `OnAvailablePersisted` → idle sync |
| MarkFresh закрыл Refresh cache-corr | force post-dump sync |

---

## 4. NC (одна нить = весь конвейер)

| Corr | groupKind | Шаги |
|------|-----------|------|
| `…cache:{runId}` | action | Refresh: invalidate → OPT reset → wait dump → fresh |
| `…lifecycle:{runId}` | lifecycle | Refresh: archive → убрать expired из наборов → wait dump → **дописать новые** → done |
| `…checkup:{runId}` | checkup | Суточный: те же шаги актуальности (без Action-кэша) |
| `…baskets:{runId}` | checkup | Только если sync без предшествующего sweep |

Post-dump **продолжает** lifecycle/checkup (не отдельная нить). Нить после sweep —
`underway` на «ожидание справочника», `resolved` после дозаписи новых тикеров.

---

## 5. Якоря в коде

| Слой | Файлы |
|------|--------|
| Sweep / post-dump | `InstrumentLifecycleService.cs` |
| NC | `CatalogRefreshNc.cs` |
| Miss → signal | `ConnectorSession` → `onAvailablePersisted` |
| Queue → signal | `InstrumentCatalogPersistWriter` |
| Connect | `ConnectionManager` (sweep + callback) |
| Tests | `CatalogRefreshNcTests`, `InstrumentLifecycleBasketSyncTests` |

---

## 6. Gaps

| Тема | Статус |
|------|--------|
| Dynamic в Refresh | после v1 |
| Mid-day auto re-eval без dump/Refresh | out of scope |
| Host up через полночь без connect | checkup на первом connect после ≥06:00 МСК |
