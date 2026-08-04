# Phase 11 — Issues: объектная модель NC (Thread / Incident / Group)

Статус: **I1 RESOLVED** (11.8–11.12) · **I2 RESOLVED** (fan-out журнал↔NC) ·
**I13 FIX** (adopt/open SoT = journal) · **I14 DONE** (soft-delete sync).
Обновлено: 2026-08-02.

Связано: [plan.md](plan.md), [to-threads.md](to-threads.md), [persistence.md](persistence.md),
журнал инцидентов — [../phase8/incident-journal.md](../phase8/incident-journal.md),
soft-delete — [../phase8/incident-soft-delete.md](../phase8/incident-soft-delete.md),
инциденты связи/crash — [../phase7j/incident.md](../phase7j/incident.md),
[../phase7j/nc-availability.md](../phase7j/nc-availability.md).
Смежный **I12** (orphan FATAL / pool) — клиент DONE в 7j.22, не issue phase 11 —
[../phase7j/issue.md](../phase7j/issue.md) I12.

---

## I2. Рассинхрон эпизода: NC Thread ≠ строка `incident` (гант)

**Статус:** RESOLVED · 2026-07-29.

### Симптом

Живой пример (2026-07-29): crash `ohs.backend.outage:…` в **Центре уведомлений** — Thread
`RESOLVED`, `16:39:57 → 16:48:02`, исход recovered. В таблице **`incident`** / на Connection-ганте
эпизод оставался **`active`** (без `closed_at`) — зелёного маркера восстановления нет.

NC «идеален» по ленте; журнал/гант отстают или расходятся. Оператор видит два разных мира.

### Почему так вышло

После 11.13 заведены **два независимых write-path** на один жизненный цикл:

```text
OHS domain ──┬──► Hub / notification (атомы) ──► NC projectThreads → Thread
             └──► JournalRegistrator ──► incident ──► гант / экран журнала
```

- NC берёт эпизод **проекцией** из атомов (`GET /api/notifications` / Hub ← таблица `notification`).
- Журнал пишется **императивно** рядом (`JournalRegistrator`), не из той же единой структуры шага.
- Crash/outage: клиентский batch mock-POST (`unavailable` / `recovering` / `recovered`) мог уходить
  **параллельно** → `Resolve` в журнале no-op до `Open` → строка навсегда `active`, пока NC уже
  `RESOLVED`.
- Часть путей глотает ошибки журнала (`SafeAsync`) при уже успешном атоме в NC.

Важно: проблема не в том, «кто кого обогнал в UI», а в том, что **нет гарантии одной и той же
информации** в обоих приёмниках.

### Что не является решением

- Делать SoT таблицу `notification` и строить `incident` SELECT’ом из NC — **нет**: NC вторичен
  (регистрация/лента). Выключили NC — гант и журнал не должны ломаться.
- Ломать работающую проекцию Thread в NC ради журнала — **нет**.

### Предлагаемое решение

**Источник факта — OHS (домен).** Один шаг жизненного цикла → один набор полей → fan-out в оба
приёмника:

```text
                ┌─► incident     (границы эпизода для ганта / журнала)
OHS ─ IncidentStep ─┤
                └─► notification (+ Hub → NC)  (стек/лента; тот же corr / ts / outcome)
```

1. **Один эмиттер (fan-out фасад)** — не разрозненные `Hub.Open` + `JournalRegistrator` из разных
   мест. Manager / Supervisor / crash-ingest / manual resolve зовут только фасад.
2. **Один DTO шага** (`IncidentStep`: corr, at, type, status/outcome, connectionId, …) → мапперы
   в строку `incident` и в атом(ы) NC. Одинаковые `corr_uid`, `opened_at`/`closed_at`, `close_outcome`.
3. **Форма разная, смысл один:** журнал — упрощённо начало/конец (и исход); NC — полный стек Entry.
   Результат по эпизоду единый.
4. **Идемпотентность** по corr + шагу; повтор не плодит второй эпизод и не оставляет «NC closed /
   journal open».
5. **NC остаётся выключаемым:** отказ persist/UI уведомлений не откатывает домен и журнал.
6. **Страховка (позже):** редкий reconcile corr terminal в `notification` vs `incident` = алерт на
   баг эмиттера, не второй SoT.

Частичные паллиативы уже в коде (последовательный mock-POST, retry resolve) — недостаточны без
единого fan-out.

**Сделано:** `IncidentStep` + `IncidentFanOut`; break/crash/manual через фасад; регрессия
recovered-before-open + parallel crash (unit + ApiTest).

### Критерий приёмки I2

- [x] Один и тот же эпизод: `incident` согласован с NC Thread для break и crash (fan-out + roundtrip).
- [x] NC off / без NcCode → журнал пишется (journal-only steps).
- [x] После terminal-шага нет «Hub resolved / journal active» (retry + terminal INSERT).
- [x] Регрессия parallel crash batch (unit + `Crash_parallel_unavailable_and_recovered_*`).

### Связано

[incident-journal.md](incident-journal.md) · handoff / чат 2026-07-29 · паллиатив
`fix(ohs): sync crash journal close with NC recover order` · fan-out commits I2 step1–3.

---

## I1. Плоская лента не отражает групповые структуры и политики

### Симптом

В NC всё — **плоский список атомарных событий**. Группировка «на глаз» по `correlationId`
(клик → фильтр, I2-upsert тиков). После появления полноценных **стеков** (break: lost → recovering →
recovered / `incident_closed`; crash: unavailable → progress → recovering → recovered / schedule_end)
оператор видит шум из тиков, сирот (например одинокий `backend.recovering` в БД), и не отличает:

- **инцидент** (открыт в рабочем горизонте расписания, обязан закрыться),
- **группу** вне окна (тот же стек, но не «журнал инцидентов»),
- **одиночные** notify без lifecycle.

Живой пример (2026-07-26): crash закрыт по `schedule_end`, затем при всё ещё мёртвом Host снова
открылся FATAL в ленте — в плоской модели это «ещё строки», без политики «вне горизонта ≠ Incident».

### Почему дорабатываем объектную модель

1. **Появились групповые структуры** — не опция UI, а факт домена: один `corr` = одна нить из
   нескольких `Entry` (фазы open / progress / close).
2. **Нужны разные политики обработки** одной и той же формы стека:
   - **Incident** — Group, открытая **в рабочее время** (горизонт `desired` / расписание); обязательный
     terminal: `recovered` или принудительный `abandoned_schedule` / позже `abandoned_manual`.
   - **Group** — тот же Thread **вне** горизонта; может оставаться open при входе в сессию; новый сбой
     в окне → **новый** Incident (другой corr), не продолжение Group.
   - **Single** — атом без нити.
3. Плоский audit в БД (`notification`, V025) остаётся источником истины по **событиям**; нехватка —
   в **UI/доменной проекции** и (опционально позже) first-class Thread на сервере.
4. Расширение NC (expand Thread, фильтр по статусу **нити**, метки ★ / ⊘) невозможно честно сделать
   только фильтрами по полям атома.

### Решение (направление)

См. полное проектирование — [to-threads.md](to-threads.md).

Кратко:

```text
NotificationItem = Single | Thread
Thread (base) → Incident | Group
Entry extends Single { corr_uid }
```

**Почему не меняем таблицы в DB (v1):** колонка `data` (JSONB) покрывает изменения объектной модели
(`threadKindHint`, `closeOutcome` на open/close). Thread собирается проекцией.

**Задел журнала инцидентов:** производная `notification_thread` + индекс `thread_kind`
(`incident|group`; Single не пишется) — **когда реально заводим серверный журнал** (экран/API),
не вместе с UI Thread. Критерий — [to-threads.md](to-threads.md) §6.5.

Внедрение — пункты **11.8–11.12** в [plan.md](plan.md).

### Статус

Реализовано: типы → проекция → UI контейнеры → hints в `data` → регрессия 7j/hydrate.
См. [report.md](report.md) 11.8–11.12.

### Связанный дефект домена (не phase 11)

Thread UI сделал видимым разрыв **open break + crash + Group `auto:`** после рестарта Host.
Фикс — adopt / catch-up abandon на Host/supervisor (**7j I10**), не смена проекции Thread:
[../phase7j/issue.md](../phase7j/issue.md) I10, [../phase7j/incident.md](../phase7j/incident.md) §1.3.

---

## I13. Adopt / open break читают NC (`notification`) как SoT → break⊂break

**Статус:** FIX · 2026-08-01.

### Симптом

После purge NC (легально: зеркало) + рестарта Host: journal ещё держит open break, supervisor
открывает **второй** `connection:{id}:link:{uid}` → два красных start-маркера на ленте.

### Почему

Канон I2 / wrap-up: SoT = **supervisor + `incident` + `link_liveness`**; NC — уведомления.
Код I10 остался на as-was: `FindOpenLinkIncidentAsync` → таблица `notification`;
`IncidentFanOut.Open` гейтил journal успехом `Hub.Open`; resolve/orphan смотрели Hub corr.

### Решение

1. `IIncidentStore.FindOpenBreakAsync` — SoT для adopt.
2. Supervisor: `TryAdoptOpenBreakFromJournalAsync` (Manager first; Hub = session seed).
3. FanOut: mint corr до Hub; отказ NC не откатывает journal.
4. Manager хранит `_incidentCorr`; close/resolve без Hub-oracle.
5. `backfill-open` = seed Hub/Manager **из journal**, не V025→journal;
   плюс **зеркало NC**: каждый open journal break без atom → artificial `connection.lost`
   (`source=journal_nc_mirror`). Hub session по-прежнему один (newest) на subject.

### Критерий

- [x] NC purge + Host restart + open journal break → adopt того же corr, не второй break.
- [x] Stale-close Live не гейтится отказом Hub.Adopt.
- [x] Manual resolve при open Manager не требует совпадения Hub corr.
- [x] Два open в journal / один в NC → `backfill-open` досевает недостающий atom (стенд 2026-08-01).

### Связано

[incident-journal.md](incident-journal.md) §7 · [plan-schedule-projection.md](plan-schedule-projection.md) §P5.5 ·
7j I10 (текст «SoT=V025» — устарел; канон — journal).

---

## I14. Soft-delete: журнал / лента / ЦУ должны говорить одно

**Статус:** DONE · 2026-08-02.

### Симптом / запрос

Ложные эпизоды (напр. Auto reconnect в выходные без weekend в расписании) засоряют журнал,
Connection-ленту и ЦУ. Нужна коррекция **видимости** без уничтожения аудита; hard delete — later.

### Решение

Ось видимости ⊥ lifecycle: `deleted_at` / `deleted_by` (V030), не `status=deleted`.

- Delete open → `abandoned_manual` (+ Halt/Auto-off) → tombstone.
- Delete resolved → только tombstone; restore снимает tombstone.
- Ribbon всегда без deleted; journal — `includeDeleted`; NC — `softDeletedCorrs$` + Выбор «Удалённые».
- Live `incidentVisibilityChanged`; audit Singles без corr эпизода.

Канон и API — [incident-soft-delete.md](incident-soft-delete.md); Выбор — [nc-marks.md](nc-marks.md).

### Критерий

- [x] Delete/restore в модалке Connection и на странице журнала.
- [x] Гант/ribbon без soft-deleted; журнал с галкой «Показывать удалённые».
- [x] NC скрывает soft-deleted по default; Выбор «Удалённые» показывает с badge deleted.
- [x] Тесты store/API/NC filter; миграция V030 накатана на стенде.
