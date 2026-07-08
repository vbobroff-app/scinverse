# Phase 6a. Отчёт о выполнении

Актуальный статус работ по Phase 6a. Обновляется по мере выполнения задач из [plan.md](plan.md).

**Текущий статус:** `DONE` — схема + запись покрытия реализованы и проверены E2E.
**Обновлено:** 2026-07-08.

## Статус задач

| #    | Задача                                                        | Статус | Комментарий |
| ---- | ------------------------------------------------------------ | ------ | ----------- |
| 6a.1 | `V005__coverage_segment.sql`                                 | DONE   | Таблица + `ix` + partial-unique активного сегмента |
| 6a.2 | `V006__connector_connection.sql`                             | DONE   | Unique `name`, сид `synthetic-local` |
| 6a.3 | Накатить мигратор                                            | DONE   | V005+V006 применены, схема сверена в psql |
| 6a.4 | `CoverageSegment` + `ICoverageStore`/`CoverageStore`         | DONE   | open (идемпотентно) / extend / close |
| 6a.5 | `RecordingManager`                                           | DONE   | subscribe + open + heartbeat + close, keyed на `InstrumentKey` |
| 6a.6 | Интеграция покрытия в `OhsWorker`                            | DONE   | per-instrument start, heartbeat 2s, `StopAll("stopped")` |
| 6a.7 | `IConnectionStore`/`ConnectionStore`                         | DONE   | List/Get/Upsert(by name)/SetEnabled, `settings::jsonb` |
| 6a.8 | Тесты + build                                               | DONE   | build 0/0; 20 unit + 8 integration зелёные |
| 6a.9 | Обновить статусы в `db-design.md`/плане                     | DONE   | см. ниже |

## Критерии приёмки — чек-лист

- [x] `V005`+`V006` применены (идемпотентно при повторе).
- [x] Схема: `coverage_segment` (индексы + partial-unique активного), `connector_connection` (unique name).
- [x] Прогон записи → один открытый сегмент, растёт `trade_count`, на стопе `ended_at`.
- [x] `dotnet build` без ошибок; `dotnet test` зелёный (вкл. coverage-тесты).

## Результаты проверки

- **Схема:** `coverage_segment` — PK `segment_id` (identity), FK на `instrument`/`data_source`, `ix_coverage_instrument_source_start`, `uq_coverage_active` (partial `WHERE ended_at IS NULL`), check `status IN (recording, stopped, error)`. `connector_connection` — unique `name`, сид `synthetic-local` (source_id=2).
- **Тесты:** новый `CoverageStoreTests` — идемпотентный open, накопление `trade_count` через extend, close (`ended_at`+`status`) и открытие нового сегмента после закрытия. Всего 8 integration + 20 unit — зелёные.
- **E2E (fake connector):** `synthetic (source_id=2)` → сегмент 1 открыт → 500 сделок принято → сегмент закрыт. В БД: `trade_count=500, status=stopped, ended_at IS NOT NULL`.

## Лог выполнения

| Дата | Действие | Результат |
| ---- | -------- | --------- |
| 2026-07-08 | Созданы план и спецификации Phase 6a (`docs/dev/phase6a/**`) | Документы готовы |
| 2026-07-08 | `V005`/`V006`, сторы, `RecordingManager`, интеграция в `OhsWorker`, тесты | Реализовано, build/tests зелёные |
| 2026-07-08 | E2E-прогон на fake-коннекторе + сверка `coverage_segment` в БД | Сегмент открыт/закрыт, `trade_count=500` |

## Следующий шаг

Phase 6b — control-plane: хост → ASP.NET Core, REST + WebSocket, фабрика коннекторов
(включает `IConnectionStore` в API) и in-memory-креды для боевого transaq.
