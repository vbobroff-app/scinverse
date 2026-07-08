# Phase 6a. Особенности реализации и спецификации

Технические детали `V005`/`V006` и компонентов записи покрытия. Общие правила мигратора —
в [../phase0/apply.md](../phase0/apply.md).

## Миграции

### V005 — coverage_segment

```sql
-- Сегмент записи (сессия) — «колбаска» на Ганте. Дыры не хранятся (выводятся из md_trade).
CREATE TABLE IF NOT EXISTS coverage_segment (
    segment_id    BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    instrument_id BIGINT      NOT NULL REFERENCES instrument (instrument_id),
    source_id     SMALLINT    NOT NULL REFERENCES data_source (source_id),
    started_at    TIMESTAMPTZ NOT NULL,
    ended_at      TIMESTAMPTZ,                       -- NULL = запись активна
    trade_count   BIGINT      NOT NULL DEFAULT 0,
    status        TEXT        NOT NULL DEFAULT 'recording',  -- recording / stopped / error
    CONSTRAINT ck_coverage_status CHECK (status IN ('recording', 'stopped', 'error'))
);

-- Выборка сегментов по инструменту/источнику в окне Ганта.
CREATE INDEX IF NOT EXISTS ix_coverage_instrument_source_start
    ON coverage_segment (instrument_id, source_id, started_at);

-- Не более одного активного сегмента на (instrument, source).
CREATE UNIQUE INDEX IF NOT EXISTS uq_coverage_active
    ON coverage_segment (instrument_id, source_id) WHERE ended_at IS NULL;
```

### V006 — connector_connection

```sql
-- Подключения коннекторов (управляются из UI в 6b). Секретов НЕ храним.
CREATE TABLE IF NOT EXISTS connector_connection (
    connection_id BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id     SMALLINT    NOT NULL REFERENCES data_source (source_id),
    name          TEXT        NOT NULL UNIQUE,
    kind          TEXT        NOT NULL,              -- transaq / synthetic
    settings      JSONB       NOT NULL DEFAULT '{}', -- несекретное: host/port/dllPath/timeouts
    enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Демо-подключение без env-специфики (боевой transaq заводится в 6b из UI/конфига).
INSERT INTO connector_connection (source_id, name, kind, settings)
VALUES (2, 'synthetic-local', 'synthetic', '{}')
ON CONFLICT (name) DO NOTHING;
```

Заметки:
- **`uq_coverage_active`** (partial unique index) гарантирует ровно один открытый сегмент на
  `(instrument, source)` — инвариант `RecordingManager`.
- `status` строкой + CHECK (мало значений, читаемо в psql); при росте — вынести в справочник.
- Боевое `transaq`-подключение НЕ сидируем в миграции (host/креды — env-специфика); заведём в 6b.

## Домен и сторы

- `CoverageSegment` (record): `SegmentId, InstrumentId, SourceId, StartedAt, EndedAt?, TradeCount, Status`.
- `ICoverageStore` (Domain) / `CoverageStore` (Storage.Timescale, Dapper):
  - `OpenAsync(instrumentId, sourceId, startedAt) → segmentId` — `INSERT … RETURNING segment_id`;
    при конфликте активного сегмента (уже открыт) — вернуть существующий (идемпотентность старта).
  - `ExtendAsync(segmentId, addedCount) ` — `UPDATE … SET trade_count = trade_count + @n,
    updated_at=now()` (heartbeat). `ended_at` не трогаем, пока активен.
  - `CloseAsync(segmentId, endedAt, status)` — `UPDATE … SET ended_at=@t, status=@s`.
- `IConnectionStore` / `ConnectionStore`: `ListAsync`, `GetAsync(id)`, `UpsertAsync`, `SetEnabledAsync`
  (без секретов). В 6a — только стор (CRUD по HTTP — 6b).

## RecordingManager (6a-объём)

Держит карту активных записей `(InstrumentKey → RecordingState { segmentId, sourceId })`.
- `StartAsync(instrument, sourceId)` — подписывает коннектор (`SubscribeTradesAsync`) и открывает
  сегмент через `CoverageStore.OpenAsync`.
- `HeartbeatAsync(instrument, addedCount)` — `CoverageStore.ExtendAsync` (вызывается воркером после
  флашей батчей — по накопленному числу принятых сделок инструмента).
- `StopAllAsync(status)` — закрывает все активные сегменты (`CloseAsync`).

Динамический `StopAsync(instrument)` + unsubscribe и старт по HTTP — 6b.

## Интеграция в OhsWorker (6a)

Текущий воркер после `connect`+`subscribe` крутит цикл чтения сообщений. Изменения:
- источник (`sourceId`) уже резолвится (phase 5);
- вместо прямого `SubscribeTradesAsync` — `recordingManager.StartAsync(instrument, sourceId)` по
  каждому инструменту из конфига (внутри — subscribe + open segment);
- принятые сделки считаем **по инструменту**; периодически (по таймеру/каждые N сделок) —
  `recordingManager.HeartbeatAsync(instrument, delta)`;
- при остановке (`OperationCanceledException`/shutdown) — `recordingManager.StopAllAsync("stopped")`.

Так «колбаска» появляется на старте, растёт по мере записи и закрывается на стопе — ровно то, что
рисует Гант.

## Команды

```powershell
# 6a.3 — накат
dotnet run --project db/Scinverse.Db.Migrator

# верификация схемы
docker exec scinverse-timescaledb psql -U scinverse -d scinverse -c "\d+ coverage_segment" -c "\d+ connector_connection"

# после прогона записи — активный сегмент и рост trade_count
docker exec scinverse-timescaledb psql -U scinverse -d scinverse -c "SELECT segment_id, instrument_id, source_id, started_at, ended_at, trade_count, status FROM coverage_segment ORDER BY segment_id DESC LIMIT 10;"

# сборка/тесты
dotnet build services/online-history-server/Ohs.sln
dotnet test  services/online-history-server/Ohs.sln
```
