# Phase 5. Особенности реализации и спецификации

Технические детали `V004` и сквозного `SourceId`. Общие правила мигратора (DbUp, embedded-скрипты,
журнал `schemaversions`, forward-only, строка подключения) — в [../phase0/apply.md](../phase0/apply.md).

## Файл миграции

- Путь: `db/migrations/V004__data_source_and_source_id.sql` (embed'ится в мигратор автоматически).
- Аддитивна для схемы, **изменяет** PK `md_trade` и бэкфиллит существующие строки.
- Идемпотентность объектов — `IF NOT EXISTS` / `ON CONFLICT`, где применимо; для `ADD CONSTRAINT`
  (нет `IF NOT EXISTS` в PG) идемпотентность обеспечивает журнал DbUp (скрипт применяется один раз).

## Целевой DDL

```sql
-- Мультиисточник (Решение 3, вариант A): источник — свойство наблюдения, входит в PK факта.

-- Справочник источников (аналог market/board).
CREATE TABLE IF NOT EXISTS data_source (
    source_id SMALLINT PRIMARY KEY,
    code      TEXT NOT NULL UNIQUE,   -- 'transaq' / 'synthetic' / 'qscalp'
    name      TEXT
);

INSERT INTO data_source (source_id, code, name) VALUES
    (1, 'transaq',   'TRANSAQ Connector (Finam)'),
    (2, 'synthetic', 'Synthetic/demo generator'),
    (3, 'qscalp',    'QScalp .qsh history')
ON CONFLICT (source_id) DO NOTHING;

-- md_trade: добавляем source_id, бэкфиллим существующие (тестовые) строки как transaq.
ALTER TABLE md_trade ADD COLUMN IF NOT EXISTS source_id SMALLINT;
UPDATE md_trade SET source_id = 1 WHERE source_id IS NULL;
ALTER TABLE md_trade ALTER COLUMN source_id SET NOT NULL;

-- FK на справочник источников (md_trade — hypertable, ссылается на обычную таблицу: поддерживается).
ALTER TABLE md_trade
    ADD CONSTRAINT fk_md_trade_source FOREIGN KEY (source_id) REFERENCES data_source (source_id);

-- Пересобираем PK: source_id входит в ключ (провенанс + сохранение нахлёстов источников).
ALTER TABLE md_trade DROP CONSTRAINT pk_md_trade;
ALTER TABLE md_trade
    ADD CONSTRAINT pk_md_trade PRIMARY KEY (instrument_id, source_id, trade_no, ts);
```

### Проектные заметки

- **Порядок PK — `(instrument_id, source_id, trade_no, ts)`.** `instrument_id` ведущий: основной
  доступ «по инструменту» (совпадает с `ix_md_trade_instrument_ts`). `ts` обязан входить в PK
  hypertable (партиционирование) — он последний. `db-design.md` показывает `(source_id, …)` первым
  лишь иллюстративно; здесь фиксируем instrument-first.
- **Без `DEFAULT` на `source_id`.** Писатель всегда указывает источник явно; дефолт скрывал бы
  ошибку «забыли источник».
- **FK, не lookup.** FK на `data_source` даёт целостность (нельзя записать неизвестный источник);
  накладные расходы сопоставимы с уже существующим FK `md_trade → instrument`.
- **Бэкфилл.** Существующие строки тестовые и одноисточниковые → `source_id = 1 (transaq)`.

## Сквозной SourceId в C#

Источник — свойство коннектора (Решение 3: «каждый `IMarketConnector` знает свой источник»).

1. **`IMarketConnector.SourceCode : string`** — код источника коннектора.
   `TransaqConnector` → `"transaq"`, `FakeReplayConnector` → `"synthetic"`.
2. **`ISourceStore.ResolveIdAsync(code, ct) : short`** (Storage.Timescale, Dapper):
   `SELECT source_id FROM data_source WHERE code = @code` — резолв кода в `source_id` на старте.
3. **`TradeRecord.SourceId : short`** (required) — добавляется в доменную запись.
4. **`TradeNormalizer.TryNormalize(trade, sourceId, out record)`** — прокидывает `SourceId` в запись.
5. **`OhsWorker`** на старте резолвит `_sourceId = ResolveIdAsync(connector.SourceCode)` и передаёт
   его в нормализатор для каждой сделки.

### TimescaleTradeWriter (изменения SQL)

- staging: добавить `source_id smallint` в `_stage_trade`;
- `COPY _stage_trade (…, source_id …)` + `writer.WriteAsync(trade.SourceId, Smallint)`;
- `INSERT INTO md_trade (…, source_id) SELECT …, source_id FROM _stage_trade`
  `ON CONFLICT (instrument_id, source_id, trade_no, ts) DO NOTHING`.

## Тесты

- **Unit `TradeNormalizerTests`** — вызвать `TryNormalize(trade, sourceId: 1, out record)`,
  проверить `record.SourceId == 1`.
- **Integration `TimescaleTradeWriterTests`** — `TradeRecord` получает `SourceId`; дедуп-тест
  комментирует конфликт по `(instrument_id, source_id, trade_no, ts)`. Фикстура (`TimescaleFixture`)
  уже прогоняет реальные миграции → `data_source` засеян автоматически; при желании добавить
  `SourceId => 1`. Проверить: запись двух источников по одному `(instrument_id, trade_no, ts)` даёт
  **две** строки (нахлёст сохраняется).

## Команды

```powershell
# 5.2 — накат
dotnet run --project db/Scinverse.Db.Migrator

# 5.2 — верификация схемы
docker exec scinverse-timescaledb psql -U scinverse -d scinverse -c "\d+ md_trade" -c "SELECT * FROM data_source ORDER BY source_id;" -c "SELECT scriptname FROM schemaversions ORDER BY schemaversionsid;"

# 5.7 — сборка и тесты
dotnet build Ohs.sln
dotnet test Ohs.sln

# 5.7 — проверка source_id на существующих строках
docker exec scinverse-timescaledb psql -U scinverse -d scinverse -c "SELECT source_id, count(*) FROM md_trade GROUP BY source_id;"
```
