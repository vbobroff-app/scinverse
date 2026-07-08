# Phase 5. Мультиисточник (V004 + сквозной SourceId) — подробный план

**Цель.** Активировать **Решение 3** (вариант A) из
[`../../architecture/db-design.md`](../../architecture/db-design.md): источник данных становится
свойством **наблюдения** и входит в ключ факта. Аддитивной миграцией `V004` добавить справочник
`data_source` и колонку `source_id` в `md_trade` (с включением в PK), затем протащить `SourceId`
сквозь пайплайн записи (parser → normalizer → batcher → writer → `md_trade`).

Зачем сейчас: следующий шаг (Гант покрытия) красит «колбаски» по источнику (`цвет = источник`), а
бэкфилл истории QScalp кладёт те же инструменты из другого источника с сохранением нахлёстов.

## Исходное состояние (предусловия)

- Фаза 0/1/3/4 завершены: `V001`–`V003` накатаны, мигратор (`db/Scinverse.Db.Migrator`, DbUp) рабочий.
- `md_trade` существует, PK = `(instrument_id, trade_no, ts)`, hypertable по `ts`.
- В `md_trade` лежат **тестовые** данные (смоук 2026-07-01 + живой прогон SBER 2026-07-08).
- Объём фазы ограничен: **`data_source` + `source_id` на `md_trade`** и сквозной `SourceId` в C#.

## Ключевое решение: существующие данные в md_trade

Смена PK требует определить `source_id` для уже лежащих строк. Данные тестовые и одноисточниковые
(писались коннекторами через тот же путь), поэтому:

- **Выбрано:** бэкфилл существующих строк `source_id = transaq` (данные сохраняем), затем
  `SET NOT NULL` и пересборка PK. Data-preserving, forward-only-safe.
- Альтернатива (отклонена): `TRUNCATE md_trade` перед сменой PK — проще, но теряем живой сэмпл SBER
  без пользы.

## Границы схемы (что входит / что нет)

- **Входит:** `data_source` (справочник), `md_trade.source_id` + новый PK.
- **Не входит (future):** `instrument_alias` (обобщение `transaq_secid` — понадобится при втором
  источнике по тому же инструменту, не сейчас); `source_id` в `md_orderlog`/`md_book_snapshot`
  (Stage 2); `data_source.priority` (выбор источника на чтении — забота ODS).

## Порядок колонок в PK

`PRIMARY KEY (instrument_id, source_id, trade_no, ts)` — `instrument_id` ведущий (локальность
доступа «по инструменту», согласовано с вторичным индексом `ix_md_trade_instrument_ts`). В
`db-design.md` Решение 3 показывает `(source_id, instrument_id, …)` иллюстративно; фиксируем
instrument-first как рабочий вариант (см. [apply.md](apply.md)).

## Коды источников (сид)

`transaq` (1), `synthetic` (2), `qscalp` (3, задел). Строчные — совпадают с `kind` коннектора и
будущими `connector_connection.kind`.

## Задачи

| #   | Задача                                                                                  | Тип        |
| --- | --------------------------------------------------------------------------------------- | ---------- |
| 5.1 | `db/migrations/V004__data_source_and_source_id.sql` (справочник + сид + бэкфилл + PK)    | правка     |
| 5.2 | Накатить: `dotnet run --project db/Scinverse.Db.Migrator`                                | выполнение |
| 5.3 | Домен: `SourceId` в `TradeRecord`; резолв источника (`code → source_id`)                 | правка     |
| 5.4 | `TradeNormalizer` протаскивает `SourceId`; `OhsWorker` задаёт источник коннектора        | правка     |
| 5.5 | `TimescaleTradeWriter`: `source_id` в staging/COPY/INSERT и в `ON CONFLICT`              | правка     |
| 5.6 | Тесты: юнит-нормализатор (+source), интеграционный писатель (+source, дедуп по новому PK) | правка     |
| 5.7 | Build + тесты + верификация живого ингеста (сделки пишутся с `source_id=transaq`)         | проверка   |
| 5.8 | Обновить статус Решения 3 в `db-design.md` и `report.md`                                  | правка     |

## Результаты (deliverables)

- Миграция `V004__data_source_and_source_id.sql` (embedded), applied → 4-я запись в `schemaversions`.
- `data_source` с сидом; `md_trade.source_id NOT NULL`, PK `(instrument_id, source_id, trade_no, ts)`.
- Сквозной `SourceId` в C#: `TradeRecord`, `TradeNormalizer`, `TimescaleTradeWriter`, `OhsWorker`.
- Зелёные unit + integration тесты; живой прогон пишет сделки с корректным `source_id`.

## Критерии приёмки

1. Мигратор завершается `0`, применён ровно один новый скрипт (`V004`); повторный прогон идемпотентен.
2. `data_source` содержит `transaq/synthetic/qscalp`; `md_trade.source_id NOT NULL`;
   PK = `(instrument_id, source_id, trade_no, ts)`; FK `md_trade.source_id → data_source`.
3. Существующие строки `md_trade` сохранены и имеют `source_id = transaq`.
4. `dotnet build Ohs.sln` без ошибок; `dotnet test` зелёный (unit + integration).
5. Живой прогон против TRANSAQ пишет новые сделки с `source_id = transaq`; дедуп идемпотентен
   по новому PK.

## Вне объёма фазы

- `instrument_alias`, миграция `transaq_secid` в него.
- `coverage_segment` / `connector_connection` (phase 6), `RecordingManager`, API/WS.
- Динамический выбор источника из UI; приоритезация источников на чтении (ODS).
