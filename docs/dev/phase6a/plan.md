# Phase 6a. Схема покрытия + запись (coverage) — подробный план

**Цель.** Заложить фундамент управления записью и панели покрытия (Гант) на стороне БД и домена,
**без сетевого слоя**: миграции `V005` (`coverage_segment`) и `V006` (`connector_connection`),
доменные компоненты `RecordingManager` + `CoverageWriter`, интеграция записи покрытия в текущий
write-path. ASP.NET Core / REST / WebSocket / динамический старт-стоп из UI — **phase 6b**.

Зачем сейчас: coverage-сегменты — источник «колбасок» на Ганте; их надо начать писать при записи
данных. `connector_connection` — модель подключений, которыми позже (6b) управляет UI.

## Исходное состояние (предусловия)

- Phase 5 завершена: `V004` (`data_source` + `md_trade.source_id`), сквозной `SourceId`.
- Хост — `BackgroundService` (`OhsWorker`) на статическом конфиге; коннектор — DI-синглтон.

## Модель покрытия (гибрид, напоминание)

- **Сегмент = сессия записи** `(instrument, source, started_at, ended_at)`; `ended_at IS NULL` — идёт.
- Реальные внутрисессионные **дыры** НЕ хранятся — выводятся запросом из `md_trade` по порогу
  `GapThreshold` (это уже read-time, phase 6b/7).
- 6a пишет только сегменты (+ `trade_count` heartbeat).

## Решение по секретам коннекторов (принято)

По образцу примера Finam (креды вводятся в форме, живут в памяти, не персистятся):
- `connector_connection.settings` (JSONB) — **только несекретное**: `host`, `port`, `dllPath`,
  таймауты. Секретов в БД нет.
- Креды (login/password) — в памяти сервера на сессию (вводятся из UI в 6b); для dev опционально
  сидируются из `appsettings.Local.json` по коду подключения. `GET /connections` их не отдаёт.
- В 6a вводится только **схема** (`connector_connection`) и её стор; фабрика коннекторов из
  подключения + in-memory креды — 6b.

## Задачи

| #    | Задача                                                                                | Тип        |
| ---- | ------------------------------------------------------------------------------------- | ---------- |
| 6a.1 | `V005__coverage_segment.sql` (таблица + индекс)                                       | правка     |
| 6a.2 | `V006__connector_connection.sql` (таблица + уникальность name; сид `synthetic`)       | правка     |
| 6a.3 | Накатить мигратор                                                                     | выполнение |
| 6a.4 | Домен/стор: `CoverageSegment`, `ICoverageStore` + `CoverageStore` (open/extend/close) | правка     |
| 6a.5 | `RecordingManager`: активные записи `(instrument, source)` → open/extend/close сегмент | правка     |
| 6a.6 | Интеграция в `OhsWorker`: старт сегмента при подписке, heartbeat по батчам, close на стопе | правка |
| 6a.7 | `IConnectionStore` + `ConnectionStore` (CRUD-стор `connector_connection`, без секретов) | правка   |
| 6a.8 | Тесты: интеграционные `CoverageStore` (open→extend→close, активный сегмент) + build     | правка     |
| 6a.9 | Обновить `report.md`, статус в `db-design.md`/плане                                    | правка     |

## Результаты (deliverables)

- Миграции `V005`, `V006` (applied), записи 5 и 6 в `schemaversions`.
- `coverage_segment`, `connector_connection` в БД.
- `RecordingManager` + `CoverageWriter`/`CoverageStore`; при прогоне записи появляется открытый
  сегмент, растёт `trade_count`, на остановке — закрывается (`ended_at`).
- Стор подключений (без секретов). Зелёные build + тесты.

## Критерии приёмки

1. Мигратор применил `V005`+`V006` (идемпотентно при повторе).
2. `coverage_segment` (PK `segment_id`, FK на `instrument`/`data_source`, индекс
   `(instrument_id, source_id, started_at)`); `connector_connection` (уникальный `name`,
   `settings JSONB`, `enabled`).
3. Прогон записи создаёт **один открытый** сегмент на `(instrument, source)`, `trade_count` растёт,
   на остановке `ended_at` проставляется.
4. `dotnet build` без ошибок; `dotnet test` зелёный (unit + integration, вкл. новый coverage-тест).

## Вне объёма фазы (→ 6b)

- Перевод хоста на ASP.NET Core; REST + WebSocket.
- Фабрика коннекторов по `kind` из `connector_connection`; in-memory креды; тест подключения.
- Динамический старт/стоп записи из UI; live-push покрытия по WS.
- Вычисление внутрисессионных дыр из `md_trade` (read-time, для Ганта).
