# Phase 11 — Schedule as projection (to-be)

**Статус:** `DESIGN AGREED` · **код — NOT STARTED** (2026-07-31)  
**Канон идеологии** для журнала, NC, Connection-ганта и writers.

**Связано:** wiki [`incident.md`](../../wiki-readme/incident.md) · [`layers.md`](../../wiki-readme/layers.md) ·
план миграции [`plan-schedule-projection.md`](plan-schedule-projection.md) ·
as-is journal [`incident-journal.md`](incident-journal.md) · as-is crash [`crash-dispatch.md`](crash-dispatch.md) ·
handoff [`promt.md`](../../promt.md) §8.

**Зачем отдельный файл:** as-is спеки (`incident-journal`, `crash-dispatch`) описывают
**классификацию по schedule** (Incident vs Group, journal только в горизонте). Их не переписываем
целиком — помечаем устаревшие куски и ссылаемся сюда. Этот документ = **to-be модель**.

---

## 1. Принцип

```text
Регистрируем каждый data-affecting failure честно (crash / break / релевантный 500),
независимо от расписания.

Расписание — проекция / маска, а не классификатор «инцидент или нет».
```

```text
incident_journal (факты, полный span)
        │
        ├── UI: Schedule void mask (чёрный ~0.8) поверх Connection-трека
        └── Writers: ScheduleCutter → type-agnostic gaps ∩ desired
                     ▲
                   SCD-2 schedule
link_liveness ──► голубое/серое (факт link); с маской тот же трек гасится вместе
```

---

## 2. Что не смешивать

| Механизм | Роль | Визуал Full |
|----------|------|-------------|
| **SessionFilter** Full / moex | Схлопывает **ось** времени (другая геометрия) | другая ось |
| **Schedule void mask** | Гасит зоны **вне desired** на той же Full-оси | та же ось + void |
| **ScheduleCutter** | Серверный клип интервалов для recovery / backfill | не UI |
| **Supervisor Auto** | connect / disconnect по `desired` | серое / idle — норма |

Маска ≠ SessionFilter. Toggle маски не должен менять геометрию оси.

---

## 3. Факты (journal)

### 3.1. Что пишем

- Break per connection — всегда Incident-строка (полный `[openedAt, closedAt]`).
- Crash Host — факт сбоя; **влияние на данные** по connections отражается в scope
  (as-is: fan-out N rows `:c{id}`; to-be предпочтение: 2NF — одна строка crash +
  `incident_connection`).
- Релевантные 500 / unhandled, которые рвут захват — да.

### 3.2. Чего не делаем

- Не решаем Group vs Incident по `desired@open`.
- Не клипуем journal-span по горизонту (`:h` bake — **отклонён**; WIP откатан, в коде нет).
- Не закрываем эпизод «потому что кончился день по расписанию» как замену recovered
  (`abandoned_schedule` — выключить **после** появления Cutter/mask).

### 3.3. Ручная / плановая норма

Ручной disconnect и плановый Auto-stop — **не** инцидент. На треке: серое /
masked void, не цветной стек.

---

## 4. NC

| Правило | To-be |
|---------|--------|
| Crash / break | всегда **Incident** (честно) |
| Group для outage | **deprecate** |
| Фильтр по `connectionId` | показывает connection-scoped break и (пока) fan-out crash; transport crash — не прятать фильтром «соединение» **или** позже отдельный toggle T |
| Header subject | `connection:{id}` как у break (уже принято) |

Local Single FATAL на WS drop (память) остаётся UX-слоем до hydrate.

---

## 5. UI — Schedule void mask

### 5.1. Поведение

- Toggle (имя TBD, не путать с SessionFilter).
- Вне `desired` на Connection-треке — полупрозрачный чёрный (~0.8) void.
- Tooltip пример: «Окно простоя 01:00 – 06:50».
- Маска **сверху** z-order (после liveness, break, crash, markers).
- Одна маска на весь трек: liveness и инциденты в антифазе — нельзя резать только
  красное и оставлять голубые хвосты.

### 5.2. Z-order (снизу вверх)

1. `link_liveness`
2. break
3. crash
4. markers 1px
5. **Schedule Mask**

---

## 6. ScheduleCutter (writers / gaps)

Вход: интервалы «нет данных» (из journal и/или coverage gaps) + SCD-2 desired окна connection.

Выход: **только** `interval ∩ desired` — без маркеров, без различия crash vs break
(для recovery это «дыра в окне записи»).

Потребители: backfill / catch-up writers, отчёты покрытия в work time.

Cutter **не** пишет в `incident` и **не** меняет NC.

---

## 7. Supervisor — разделение ролей

| Оставить | Убрать (после switchover) |
|----------|---------------------------|
| Auto connect / disconnect по `desired` | Вся schedule-логика **в контексте инцидента** |
| | `abandoned_schedule` как close-reason / классификатор |
| | desired → Incident vs Group в crash fan-out |

Crash концептуально **transport**; break — **per connection**. Journal сегодня размножает
crash на N `:c{id}` — допустимый as-is; цель 2NF — отдельный шаг плана.

---

## 8. As-is → deprecate

| As-is | Статус |
|-------|--------|
| `desired@open` → Incident vs Group | **снято** (P3/P4.1): outage всегда Incident |
| Journal только «в горизонте» | **снято** (P3): полный span |
| Clipped Incident `:h` (Group∩desired) | **отклонён**; docs в crash-dispatch помечены obsolete; кода нет |
| Group для outages в NC | **снято** (P4.1); Group auto-connect оставлен |
| `abandoned_schedule` | **выключен** в live-path (P4.2): Auto disconnect не resolve; outcome остаётся в journal/API истории |

Пока as-is код живёт — поведение продуктово «старое»; новые фичи не углублять в эту ветку.

---

## 9. Критерии готовности to-be (acceptance)

1. Crash ночью + overlap с morning session → **одна** (или 2NF+scope) journal-нить полного span;
   на ганте с маской void вне окна; writers видят только ∩ desired.
2. Break вне окна → строка journal + Incident в NC; без маски виден полный факт.
3. SessionFilter moex и mask-toggle независимы.
4. Auto disconnect в конце окна не создаёт ложный «resolve инцидента» через abandon.
5. Unit/vitest на Cutter; UI tooltip void; регресс ribbon / I10 Adopt Live-only.

---

## 10. Решения, зафиксированные в обсуждении

- Маска общая для liveness + incidents (антифаза).
- Writers нуждаются в Cutter-выходе (клип), UI — в mask (не обязательно тот же код-путь).
- Деликатная миграция: Cutter/mask → always-Incident → P4 Group/`abandoned_schedule` (DONE);
  `:h` не воскрешать; 2NF — P5.
- Отдельная спека (этот файл) предпочтительнее полной переписки `incident-journal.md`.
