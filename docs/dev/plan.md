# План разработки Scinverse — верхний уровень

Дорожная карта работ по сервису OHS/ODS. Верхнеуровневый документ: фазы, объём, статусы и
ссылки на детальные планы. Архитектурные решения по модели данных зафиксированы в
[`../architecture/db-design.md`](../architecture/db-design.md).

Статусы фаз: **TODO** — не начато; **IN PROGRESS** — в работе; **DONE** — завершено.

## Текущий фокус

Сначала **доводим базу данных** (инфраструктура миграций + накат), затем — синхронизация
C#-конвейера и остальное. Объём сознательно ограничен реальными потребностями: сейчас есть только
источник **TRANSAQ**, поэтому мультиисточник (`source_id`) и OrderLog (Plaza2) — отложены до
появления второго источника (YAGNI).

## Фазы

| Фаза | Содержание | Объём (согласовано) | Статус | Детали |
| ---- | ---------- | ------------------- | ------ | ------ |
| 0 | Инфраструктура миграций: накат на реальную (compose) БД, воспроизводимость | **Полностью**, `source_id` вводим **вариантом A** (отдельной миграцией) | DONE | [phase0/](phase0/plan.md) |
| 1 | Миграции под принятые решения | **Только `V003`** (derivative + instrument_risk) | DONE | [phase1/](phase1/plan.md) |
| 2 | OrderLog / Plaza2 (Решение 5) + мультиисточник (Решение 3) | **Позже**, при появлении второго источника | TODO | — |
| 3 | Проверки (build + unit + integration) | **В необходимом объёме** | DONE | [phase3/](phase3/plan.md) |

## Детализация

### Фаза 0. Инфраструктура миграций — *DONE*

Мигратор (`db/Scinverse.Db.Migrator`, DbUp) уже реализован. Задача фазы — накатить существующие
миграции (`V001`, `V002`) на TimescaleDB из `docker-compose`, закрепить воспроизводимость
(пиннинг образа) и добавить удобную обвязку запуска. Подробно — в [phase0/plan.md](phase0/plan.md),
особенности реализации — в [phase0/apply.md](phase0/apply.md), статус — в [phase0/report.md](phase0/report.md).

**Итог:** образ закреплён `2.17.2-pg16`; `V001`+`V002` накатаны на локальную TimescaleDB; схема
верифицирована (hypertable, индексы, журнал); повтор идемпотентен. По ходу устранён конфликт версий
`Npgsql` ↔ `dbup-postgresql` (net8 требует Npgsql 9) — `Npgsql` поднят до `9.0.3`.

### Фаза 1. Миграция V003 (derivative + instrument_risk) — *DONE*

Реализация Решения 2 из `db-design.md`: подтип-таблица `derivative` (атрибуты FUT/OPT, 1:1 с
`instrument`, индекс цепочки опционов) и темпоральная `instrument_risk` (ГО/лимиты с историей).
Аддитивная миграция, риска для существующих данных нет. `source_id`/OrderLog в этой фазе **не**
трогаем. Подробно — в [phase1/plan.md](phase1/plan.md), DDL — в [phase1/apply.md](phase1/apply.md),
статус — в [phase1/report.md](phase1/report.md).

### Фаза 2. OrderLog / Plaza2 + мультиисточник — *TODO (позже)*

Реализация Решений 5 и 3 из `db-design.md`: `md_orderlog` + `md_book_snapshot` (event sourcing),
`data_source` + `instrument_alias`, ввод `source_id` в PK `md_trade` (вариант A — отдельной
миграцией, пересоздание hypertable на пустой БД). Плюс C#-часть: `OrderLogEvent`, коннектор Plaza2,
деривация ленты/стакана, протаскивание `SourceId` по конвейеру. Начинаем, когда реально появится
второй источник данных.

### Фаза 3. Проверки — *DONE*

`dotnet build` + unit-тесты + интеграционные (Testcontainers) на актуальной схеме — в объёме,
необходимом для затронутых изменений. Подробно — в [phase3/plan.md](phase3/plan.md), детали — в
[phase3/apply.md](phase3/apply.md), статус — в [phase3/report.md](phase3/report.md).

**Итог:** unit 20/20, integration 4/4. Проверки поймали регрессию апгрейда Npgsql 8→9 (запись
`timestamptz` требует UTC) — исправлено в `TimescaleTradeWriter` (`ToUniversalTime()`).

## Связанные документы

- [`../architecture/db-design.md`](../architecture/db-design.md) — решения по модели данных (Р1–Р5).
- [`../ohs.md`](../ohs.md) — обзор OHS.
- [`../solution/code.md`](../solution/code.md) — обзор кода vertical slice.
