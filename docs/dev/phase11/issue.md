# Phase 11 — Issues: объектная модель NC (Thread / Incident / Group)

Статус: **OPEN** (проектирование). Обновлено: 2026-07-27.

Связано: [plan.md](plan.md), [to-threads.md](to-threads.md), [persistence.md](persistence.md),
инциденты связи/crash — [../phase7j/incident.md](../phase7j/incident.md),
[../phase7j/nc-availability.md](../phase7j/nc-availability.md).

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
4. Расширение NC (expand Thread, фильтр по статусу **нити**, метки ★ / ⦸) невозможно честно сделать
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

Спека / план — в работе. Код UI Thread — не начат.
