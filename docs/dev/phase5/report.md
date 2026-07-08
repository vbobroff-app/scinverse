# Phase 5. Отчёт о выполнении

Актуальный статус работ по Phase 5. Обновляется по мере выполнения задач из [plan.md](plan.md).

**Текущий статус:** `DONE` — `V004` накатана, сквозной `SourceId` реализован и верифицирован.
**Обновлено:** 2026-07-08.

## Статус задач

| #   | Задача                                                        | Статус | Комментарий |
| --- | ------------------------------------------------------------ | ------ | ----------- |
| 5.1 | `V004` (data_source + source_id + бэкфилл + PK)              | DONE   | `db/migrations/V004__…sql` |
| 5.2 | Накатить мигратор                                            | DONE   | applied, 4-я запись в `schemaversions` |
| 5.3 | `SourceId` в `TradeRecord` + резолв источника (`ISourceStore`) | DONE   | `SourceStore` (Dapper) |
| 5.4 | `TradeNormalizer`/`OhsWorker` прокидывают `SourceId`         | DONE   | `IMarketConnector.SourceCode` |
| 5.5 | `TimescaleTradeWriter`: `source_id` в staging/COPY/INSERT/PK | DONE   | — |
| 5.6 | Тесты (unit + integration) под `source_id`                  | DONE   | +тест нахлёста источников |
| 5.7 | Build + тесты + верификация                                 | DONE   | 20 unit + 5 integration |
| 5.8 | Обновить Решение 3 в `db-design.md`                         | DONE   | PLANNED → DONE (частично) |

## Результат

Схема (после `V004`):
- `data_source` засеян: `transaq(1)`, `synthetic(2)`, `qscalp(3)`.
- `md_trade.source_id SMALLINT NOT NULL`; PK = `(instrument_id, source_id, trade_no, ts)`;
  FK `fk_md_trade_source → data_source`.
- Существующие 3216 строк бэкфилл-нуты в `source_id = 1 (transaq)`.

Сквозной `SourceId` (C#): `IMarketConnector.SourceCode` (`transaq`/`synthetic`) → `OhsWorker`
резолвит в `source_id` через `ISourceStore` → `TradeNormalizer` кладёт в `TradeRecord.SourceId` →
`TimescaleTradeWriter` пишет в `md_trade` с `ON CONFLICT (instrument_id, source_id, trade_no, ts)`.

Верификация мультиисточника (fake-прогон, `synthetic`):
- `transaq(1)` = 3216, `synthetic(2)` = 500 строк;
- **overlap_pairs = 500**: одинаковые `(instrument_id, trade_no, ts)` сосуществуют под двумя
  источниками → нахлёст сохранён, кросс-источниковый дедуп не срабатывает (Решение 3, вариант A).

## Критерии приёмки — чек-лист

- [x] Мигратор применил `V004` (идемпотентно при повторе).
- [x] `data_source` засеян; `md_trade.source_id NOT NULL`; PK `(instrument_id, source_id, trade_no, ts)`.
- [x] Существующие строки `md_trade` сохранены с `source_id = transaq`.
- [x] `dotnet build` без ошибок; `dotnet test` зелёный (20 unit + 5 integration).
- [x] Источник протаскивается сквозь пайплайн; нахлёст источников сохраняется.

## Лог выполнения

| Дата | Действие | Результат |
| ---- | -------- | --------- |
| 2026-07-08 | Созданы план и спецификации Phase 5 (`docs/dev/phase5/**`) | Документы готовы |
| 2026-07-08 | `V004` написана и накатана мигратором | `data_source` + `source_id` + новый PK; бэкфилл 3216 строк |
| 2026-07-08 | Сквозной `SourceId` (домен/коннекторы/нормализатор/писатель/воркер) | build чистый |
| 2026-07-08 | Обновлены тесты (+тест нахлёста источников) | 20 unit + 5 integration зелёные |
| 2026-07-08 | Верификация fake-прогоном (`synthetic`) | overlap_pairs=500, источники не сливаются |

## Следующий шаг

Фаза закрыта. Дальше — **phase 6**: `coverage_segment` (`V005`), `connector_connection` (`V006`),
`RecordingManager`, эволюция хоста в ASP.NET Core (REST + WebSocket).

## Заметка

В dev-БД остались 500 строк `synthetic` (source_id=2) от верификации — безвредны, пригодятся как
второй цвет на Ганте покрытия (phase 7). При желании убрать: `DELETE FROM md_trade WHERE source_id = 2;`.
