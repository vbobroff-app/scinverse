# Phase 7j — Notification Composer

**Статус:** `DONE`. **Обновлено:** 2026-07-23 (7j.17: композиция переехала внутрь атомарного
`POST …/schedule/batch`, отдельный `compose` и клиентская оркестрация удалены — см. [error-handling.md](error-handling.md)).  
**Связано:** [error-handling.md](error-handling.md), [v2-exceptions.md](v2-exceptions.md), [todo.md](todo.md), [ui-schedule.md](ui-schedule.md).

---

## 1. Проблема

Одно действие (Очистить → Утвердить / пачка upsert+cancel) → N× API → N строк в доке.

## 2. Решение

| Слой | Код | Severity | Когда |
|------|-----|----------|--------|
| **User** | `connection.schedule.applied` \| `…cleared` \| `…recreated` | `applied=info` / `cleared=warning` / `recreated=ok` | итог пачки; message = заголовок + строки деталей |
| **System** | `connection.schedule.batch` | `info` | один факт scope; `data.items` |

Композиция теперь **серверная и атомарная** — отдельный `compose` и клиентская пачка PUT/cancel
удалены (7j.17). Одно действие UI → один `POST …/schedule/batch` → один user + один system с общим
`correlationId = batchId`.

Точка входа UI: `ConnectionSchedulePopover.commit` → `OhsStore.applyConnectionScheduleBatch`
(`handlers.onSuccess/onError`; попап закрывается только при успехе).

## 3. Контракт batch

Запрос `ScheduleBatchRequest`:

```json
{
  "batchId": "uuid",
  "kind": "cleared" | "applied" | "recreated",
  "upserts": [ /* PutConnectionScheduleRuleRequest[] */ ],
  "cancels": [ /* scheduleId[] */ ],
  "items":   [{ "kind": "set" | "canceled", "label": "Сб, Вс (дни 96) 08:50–20:00", "scheduleId": 6 }]
}
```

`recreated` — когда пишем на пустое расписание (base был пуст: только upsert, без cancel).
`label` = скоуп + окно: dow → «Сб, Вс (дни 96) 08:50–20:00», off → «… выкл».

Именование в user-сообщении: `Расписание {id} («{name}»)` (id — первичен), в системном — только `{id}`.

User message (collapsed):

```
Расписание 3 («Finam»): изменено (2)
Расписание 3 («Finam»): сброшено (2)
Расписание 3 («Finam»): пересоздано (1)
```

Внутри expand (`data.lines`, столбик) — детали правил; системное `connection.schedule.batch`
использует только `id`: `Расписание 3: batch (2)`.

## 4. Файлы

- Backend: `OhsEndpoints.cs` (`POST …/schedule/batch`, `PublishBatchSuccess`), `ScheduleBatchRequest`/`ScheduleBatchResultDto` в Contracts, `ApplyBatchAsync` в `ConnectionScheduleStore`.
- Frontend: `api.ts` (`applyScheduleBatch`), `OhsStore.applyConnectionScheduleBatch`, popover `onApplyBatch`.
