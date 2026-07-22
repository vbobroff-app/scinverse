# Phase 7j — Notification Composer

**Статус:** `DONE` (MVP).  
**Связано:** [v2-exceptions.md](v2-exceptions.md), [todo.md](todo.md), [ui-schedule.md](ui-schedule.md).

---

## 1. Проблема

Одно действие (Очистить → Утвердить / пачка upsert+cancel) → N× API → N строк в доке.

## 2. Решение

| Слой | Код | Когда |
|------|-----|--------|
| **User** | `connection.schedule.cleared` \| `…recreated` \| `…batch_applied` | итог пачки; message = заголовок + строки деталей |
| **System** | `connection.schedule.batch` | один факт scope; `data.items` |
| **Атомарные** | `rule_set` / `rule_canceled` / `rule_superseded` | только **без** `batchId` (одиночные вызовы) |

Пачка:

1. Клиент генерирует `batchId`.
2. `PUT …/rule?batchId=` / `POST …/cancel?batchId=` — **без** Publish.
3. `POST …/schedule/compose` — user + system с общим `correlationId = batchId`.

Точка входа UI: `ConnectionSchedulePopover.commit` → `OhsStore.applyConnectionScheduleBatch`.

## 3. Контракт compose

```json
{
  "batchId": "uuid",
  "kind": "cleared" | "applied" | "recreated",
  "items": [{ "kind": "set" | "canceled", "label": "Сб, Вс (дни 96) 08:50–20:00", "scheduleId": 6 }]
}
```

`recreated` — когда пишем на пустое расписание (base был пуст: только upsert, без cancel).
`label` = скоуп + окно: dow → «Сб, Вс (дни 96) 08:50–20:00», off → «… выкл».

User message (collapsed):

```
Расписание 3 изменено (2)
Расписание 3 очищено (2)
Расписание 3 пересоздано (1)
```

Внутри expand (`data.lines`, столбик):

```
Расписание 3: изменения применены
Расписание 3: правило «основное» утверждено
Расписание 3: правило «дни 96» утверждено
```

Системное: `connection.schedule.batch` — по `corr` из user-строки.

## 4. Файлы

- Backend: `OhsEndpoints.cs`, `ScheduleComposeRequest` в Contracts.
- Frontend: `api.ts`, `OhsStore.applyConnectionScheduleBatch`, popover `onApplyBatch`.
