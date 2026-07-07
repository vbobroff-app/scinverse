# Фаза 1. Особенности реализации и спецификации

Технические детали миграции `V003`. Общие правила мигратора (DbUp, embedded-скрипты, журнал
`schemaversions`, forward-only, конвенции именования, строка подключения, команды) описаны в
[../phase0/apply.md](../phase0/apply.md) и здесь не дублируются.

## Файл миграции

- Путь: `db/migrations/V003__derivative_and_risk.sql`.
- Embed'ится автоматически (`<EmbeddedResource Include="..\migrations\*.sql">` в csproj мигратора).
  После добавления файла нужна пересборка (её делает `dotnet run`).
- Аддитивная миграция: только `CREATE TABLE/INDEX`, существующие данные не затрагиваются.
- DDL идемпотентен на уровне объектов (`IF NOT EXISTS`) — в паре с журналом DbUp даёт двойную защиту.

## Целевой DDL

```sql
-- Атрибуты контракта (только FUT/OPT), 1:1 с instrument (class-table inheritance).
CREATE TABLE IF NOT EXISTS derivative (
    instrument_id BIGINT  PRIMARY KEY REFERENCES instrument (instrument_id),
    underlying_id BIGINT  NOT NULL REFERENCES instrument (instrument_id),  -- базовый актив
    expiration    DATE    NOT NULL,
    option_type   CHAR(1),        -- 'C'/'P'; NULL для фьючерса
    strike        NUMERIC,        -- NULL для фьючерса
    CONSTRAINT ck_derivative_option_type CHECK (option_type IN ('C', 'P'))
);

-- Покрывает выборку опционной цепочки: базовый актив + экспирация + страйк.
CREATE INDEX IF NOT EXISTS ix_derivative_chain
    ON derivative (underlying_id, expiration, strike);

-- Волатильные риск-параметры с историей (темпоральная таблица).
CREATE TABLE IF NOT EXISTS instrument_risk (
    instrument_id    BIGINT      NOT NULL REFERENCES instrument (instrument_id),
    valid_from       TIMESTAMPTZ NOT NULL,
    initial_margin   NUMERIC,     -- ГО
    price_limit_low  NUMERIC,
    price_limit_high NUMERIC,
    CONSTRAINT pk_instrument_risk PRIMARY KEY (instrument_id, valid_from)
);
```

## Проектные заметки

- **`derivative` — подтип-таблица.** PK совпадает с FK на `instrument` (1:1). Строка есть только у
  FUT/OPT, поэтому в общем `instrument` не держим разрежённые `strike`/`expiration` (3НФ, чистая
  фильтрация цепочек).
- **Self-FK `underlying_id`.** Базовый актив — тоже строка `instrument`. Заполнение потребует, чтобы
  инструмент базового актива уже существовал (порядок upsert'а — забота будущей C#-части, Фаза 2+).
- **`option_type`.** `CHAR(1)` c CHECK `IN ('C','P')`; для фьючерса — `NULL` (CHECK допускает NULL).
- **`instrument_risk` — темпоральная.** Детерминант `(instrument_id, valid_from)`; «текущее» ГО —
  `ORDER BY valid_from DESC LIMIT 1`. Пока обычная таблица; при интрадей-обновлениях ГО можно
  перевести в hypertable (отложено, см. открытые вопросы `db-design.md`).
- **CHECK на option-специфику** (`strike NOT NULL` для опционов и т.п.) намеренно **не** добавляем:
  различение FUT/OPT — по наличию `option_type`; жёсткий CHECK усложнил бы загрузку без пользы на
  этом этапе.

## Reference-запрос (проверка индекса цепочки)

```sql
SELECT d.instrument_id, i.ticker, d.strike, d.option_type
FROM   derivative d
JOIN   instrument u ON u.instrument_id = d.underlying_id
JOIN   instrument i ON i.instrument_id = d.instrument_id
WHERE  u.ticker = 'RTS'
  AND  d.expiration = DATE '2026-09-15'
  AND  d.option_type IS NOT NULL
ORDER BY d.strike;
```

## Команды

```powershell
# 1.2 — накат
dotnet run --project db/Scinverse.Db.Migrator

# 1.3 — верификация
docker exec scinverse-timescaledb psql -U scinverse -d scinverse -c "\d+ derivative" -c "\d+ instrument_risk" -c "SELECT scriptname FROM schemaversions ORDER BY schemaversionsid;"
```
