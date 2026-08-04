# Phase 8. Особенности реализации (OHS journal)

Обзор — [plan.md](plan.md), статус — [report.md](report.md).
Детали по контурам — канон-документы ниже (перенесены из phase 11, 2026-08-04).

## Soft-delete журнала (кратко)

- **Не** `status=deleted`: колонки `deleted_at` / `deleted_by` ⊥ lifecycle.
- Delete open = `abandoned_manual` (+ Halt/Auto-off при recovering) → tombstone.
- Surfaces: ribbon всегда без deleted; journal — `includeDeleted`; NC — Выбор `deleted`
  (потребитель phase 11).
- Live: `incidentVisibilityChanged`.
- Накат DDL: `dotnet run --project db/Scinverse.Db.Migrator` (без V030 Host 500 на `/incidents`).
- Полная спека — [incident-soft-delete.md](incident-soft-delete.md).

## Журнал и ribbon

- Таблица `incident` в OHS Timescale (`V028`); запись — `JournalRegistrator` (не TradeWriter).
- Fan-out эпизода: OHS domain → journal + Hub atoms (I2) — см. [../phase11/issue.md](../phase11/issue.md).
- Connection-ribbon и Recording binary projection — [incident-journal.md](incident-journal.md) §3.
- Write Gaps (дорожка инструмента) — отдельно, [../phase7h/write-gaps.md](../phase7h/write-gaps.md).

## Crash dispatch

- Host outage: транспортный слой T + fan-out C per `connectionId`.
- Спека — [crash-dispatch.md](crash-dispatch.md).

## Schedule as projection

- Канон: факты ⊥ mask/Cutter — [schedule-projection.md](schedule-projection.md).
- План миграции — [plan-schedule-projection.md](plan-schedule-projection.md).
- Частично применено в Write Gaps (ScheduleCutter); полная смена классификации Incident/Group — open.

## Связь с NC (phase 11)

Пакет `@scinverse/notification-center`, Thread UI, dock, V025 — **не** документируются здесь.
OHS публикует atoms / visibility events; NC потребляет. Вынос NC-сервиса — Stage 2.
