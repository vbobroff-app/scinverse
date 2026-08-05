# Soft-delete инцидентов (journal SoT)

**Статус:** DONE · 2026-08-02.  
Связано: [incident-journal.md](incident-journal.md),
[../phase11/nc-marks.md](../phase11/nc-marks.md),
[../phase11/dock-settings.md](../phase11/dock-settings.md).  
Миграция: `db/migrations/V030__incident_soft_delete.sql`.

---

## 1. Зачем

Ложные / мусорные эпизоды (пример: Auto reconnect в законные выходные без weekend в расписании)
засоряют журнал, Connection-ленту (гант) и ЦУ. Нужна **коррекция видимости** без уничтожения
аудита — оператор скрывает эпизод и при необходимости возвращает.

Hard delete / retention purge — **вне scope** (позже, системный алгоритм, не UI).

---

## 2. Модель: ось видимости ⊥ lifecycle

| Ось | Поле | Значения |
|-----|------|----------|
| Lifecycle | `incident.status` | `active` \| `recovering` \| `resolved` |
| Исход | `close_outcome` | `recovered` \| `abandoned_*` (как раньше) |
| **Видимость** | `deleted_at` / `deleted_by` | `NULL` = видим; иначе soft-deleted |

**Не** вводим `status = deleted`: ломает CHECK open/resolved и все `status IN ('active','recovering')`.

UI-badge `deleted` — проекция (`deleted_at IS NOT NULL`), не 4-й lifecycle Thread/NC.

---

## 3. DDL (`V030`)

```sql
ALTER TABLE incident
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT NULL;

-- open только среди видимых
CREATE INDEX ix_incident_open ON incident (module, status)
  WHERE status IN ('active', 'recovering') AND deleted_at IS NULL;
```

Накат: `dotnet run --project db/Scinverse.Db.Migrator` (см. [`docs/promt.md`](../../promt.md)).

---

## 4. Семантика операций

### Soft-delete (`POST /api/incidents/{corr}/delete`)

1. Если эпизод **open** (`active`/`recovering`) — сначала тот же путь, что resolve:
   `abandoned_manual` + Halt Auto / Auto-off при recovering.
2. `deleted_at = now`, `deleted_by` (оператор / `superuser`).
3. Live WS: `incidentVisibilityChanged { corrUid, deleted: true, connectionId? }`.
4. Audit NC: Single **без** `correlationId` эпизода — `connection.incident_soft_deleted` (user/info):
   `Журнал инцидентов {id} («{name}»): Запись удалена оператором` (не `ScheduleWho`).
5. Атомы эпизода в hub/`notification` **не удаляются** (клиент скрывает по фильтру).

### Restore (`POST /api/incidents/{corr}/restore`)

1. `deleted_at` / `deleted_by` → NULL.
2. Best-effort: атомы corr из `notification` → `hub.Hydrate` (если ring уже без них).
3. Live: `incidentVisibilityChanged { deleted: false }`.
4. Audit Single: `connection.incident_restored` —
   `Журнал инцидентов {id} («{name}»): Запись восстановлена оператором`.

Идемпотентность: повтор delete/restore на уже нужном состоянии → 200 + текущий DTO.

### Resolve на soft-deleted

`POST …/resolve` → **409**, если `deleted_at IS NOT NULL` (сначала restore).

---

## 5. Синхронизация поверхностей (SoT = journal)

```text
UI Delete/Restore → POST delete|restore → incident.deleted_*
                         ├─ ribbon GET /connections/{id}/incidents  (всегда без deleted)
                         ├─ journal GET /incidents?includeDeleted=
                         └─ WS incidentVisibilityChanged
                              └─ client softDeletedCorrs$ → filterItems / badge
```

| Поверхность | Default | С «показать удалённые» |
|-------------|---------|-------------------------|
| Ribbon / гант | скрыты | **всегда скрыты** (флаг не пробрасываем) |
| Журнал (модалка / страница) | скрыты | галка + `includeDeleted=true` |
| ЦУ (NC) | скрыты | Выбор → **Удалённые** |

Клиент: `softDeletedCorrs$` (sync с `GET /incidents?includeDeleted=true` + live WS).  
Thread с `isSoftDeleted` → badge **deleted** (красный текст, muted фон, красный border 1px)
вместо lifecycle `resolved`/`active`.

---

## 6. API

| Метод | Назначение |
|-------|------------|
| `GET /api/incidents?…&includeDeleted=` | default `false` |
| `GET /api/connections/{id}/incidents` | без soft-deleted |
| `POST /api/incidents/{corr}/delete` | body `{ deletedBy? }` |
| `POST /api/incidents/{corr}/restore` | снять tombstone |
| Live `incidentVisibilityChanged` | sync клиентов |

DTO: `deletedAt`, `deletedBy` (+ прежние поля).  
Бэклог NC: `GET /api/notifications` default **limit=200** (hub capacity 500).

---

## 7. UI

### Журнал (модалка Connection + страница «Журнал инцидентов»)

- Edit: **Удалить** / **Восстановить** (текст по `deletedAt`).
- Delete: wizard (как close) — info → confirm; copy:

  > Инцидент будет скрыт из журнала, ленты и ЦУ.  
  > В дальнейшем можно отменить кнопкой «Восстановить».

- Галка «Показывать удалённые» — `localStorage` `ohs:incidentsJournal:showDeleted`.

### ЦУ — фильтр Выбор

| id | Label | Default |
|----|-------|---------|
| `favorite` | ★ Избранные | off |
| `left` | ⊘ Спам | off (спам скрыт) |
| **`deleted`** | **Удалённые** | **off** (soft-deleted скрыты) |

Персист choices — `ohs:notificationDock` (как остальные фильтры дока).  
Канон Выбор — [../phase11/nc-marks.md](../phase11/nc-marks.md).

---

## 8. Код (якоря)

| Слой | Файлы |
|------|--------|
| DDL | `db/migrations/V030__incident_soft_delete.sql` |
| Store | `IncidentStore` SoftDelete/Restore/Query `IncludeDeleted` |
| API | `OhsEndpoints` delete/restore + `AbandonManualJournalAsync` |
| Live | `IncidentVisibilityChangedEvent` |
| Web journal | `ConnectionIncidentsModal`, `IncidentsSection`, `incidentsJournalStorage` |
| NC | `filterItems` (`deleted`), `ThreadBlock` badge, `softDeletedCorrs$` |
| Тесты | IncidentStore / NotificationStore / ApiTests SoftDelete*; `filterItems` deleted |

---

## 9. Вне scope

- Hard delete / UI «удалить навсегда».
- Retention purge (возможный later: soft-deleted старше N + опционально старые resolved).
- `ThreadStatus = deleted` в enum NC (не нужно — ось видимости).
