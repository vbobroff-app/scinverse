# Phase 11 — Issues: объектная модель NC (Thread / Incident / Group)

Статус: **I1 RESOLVED** (11.8–11.12) · **I2 OPEN** (fan-out журнал↔NC). Обновлено: 2026-07-29.

Связано: [plan.md](plan.md), [to-threads.md](to-threads.md), [persistence.md](persistence.md),
журнал инцидентов — [incident-journal.md](incident-journal.md),
инциденты связи/crash — [../phase7j/incident.md](../phase7j/incident.md),
[../phase7j/nc-availability.md](../phase7j/nc-availability.md).

---

## I2. Рассинхрон эпизода: NC Thread ≠ строка `incident` (гант)

**Статус:** OPEN · 2026-07-29.

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

**Прогресс:** step1–3 — фасад; break Manager/Supervisor; crash ingest + manual resolve (+ SkipJournal
для жёсткого store.Resolve). Приёмка I2 / регрессия parallel crash — добить тестами.

### Критерий приёмки I2

- Один и тот же эпизод: `incident.(status, close_outcome, opened_at, closed_at)` согласован с
  Thread NC (`threadStatus` / `closeOutcome` / границы summary) для break и crash.
- NC off / сбой атомов → журнал и гант полные; док пустеет, домен жив.
- Нет пути «атом resolved в Hub, строка journal active» после успешного terminal-шага домена.
- Регрессия: unit/ApiTest на fan-out open→recover (в т.ч. бывший parallel crash batch).

### Связано

[incident-journal.md](incident-journal.md) · handoff / чат 2026-07-29 · паллиатив commit
`fix(ohs): sync crash journal close with NC recover order`.

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
