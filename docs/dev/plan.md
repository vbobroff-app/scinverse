# План разработки Scinverse — верхний уровень

Дорожная карта по сервису OHS/ODS. Работа сгруппирована в **Stages** (крупные темы), каждый Stage
состоит из **фаз** (`phaseN`) со сквозной нумерацией. Архитектурные решения по модели данных — в
[`../architecture/db-design.md`](../architecture/db-design.md); дизайн Stage 1 — в [apply.md](apply.md).

Статусы: **TODO** — не начато; **IN PROGRESS** — в работе; **DONE** — завершено.

## Stages

| Stage | Тема | Фазы | Статус |
| ----- | ---- | ---- | ------ |
| 0 | Data foundation: создание БД / инфраструктура миграций | phase0, phase1, phase3 | DONE |
| 1 | OHS apply + admin frontend: управление записью + панель покрытия (Гант) | phase4–phase9 | IN PROGRESS |
| 2 | OrderLog / Plaza2 (event sourcing) | — | FUTURE |

---

## Stage 0. Data foundation (DB) — *DONE*

Фундамент данных: инфраструктура миграций (DbUp), базовая схema и проверки.

| Фаза | Содержание | Объём | Статус | Детали |
| ---- | ---------- | ----- | ------ | ------ |
| 0 | Инфраструктура миграций: накат на compose-БД, воспроизводимость | Полностью, вариант A | DONE | [phase0/](phase0/plan.md) |
| 1 | Миграция `V003` (derivative + instrument_risk) | Только `V003` | DONE | [phase1/](phase1/plan.md) |
| 3 | Проверки (build + unit + integration) | В необходимом объёме | DONE | [phase3/](phase3/plan.md) |

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
Аддитивная миграция, риска для существующих данных нет. Подробно — в [phase1/plan.md](phase1/plan.md),
DDL — в [phase1/apply.md](phase1/apply.md), статус — в [phase1/report.md](phase1/report.md).

### Фаза 3. Проверки — *DONE*

`dotnet build` + unit-тесты + интеграционные (Testcontainers) на актуальной схеме. Подробно — в
[phase3/plan.md](phase3/plan.md), детали — в [phase3/apply.md](phase3/apply.md), статус — в
[phase3/report.md](phase3/report.md).

**Итог:** unit 20/20, integration 4/4. Проверки поймали регрессию апгрейда Npgsql 8→9 (запись
`timestamptz` требует UTC) — исправлено в `TimescaleTradeWriter` (`ToUniversalTime()`).

---

## Stage 1. OHS apply + admin frontend — *IN PROGRESS*

Превращаем OHS из «воркера на статическом конфиге» в управляемый сервис записи с админ-панелью:
пользователь выбирает инструмент и ведёт online-запись через коннектор, а Гант показывает «колбаски»
покрытия данными (цвет = источник), растущие в реальном времени, с видимыми разрывами. Полный дизайн
Stage 1 (архитектура, модель данных, API/WS, граница админка/публичная, принятые решения) — в
**[apply.md](apply.md)**.

| Фаза | Содержание | Статус | Детали |
| ---- | ---------- | ------ | ------ |
| 4 | Локальный E2E OHS (запись): смоук (fake) + реальный TRANSAQ, отладка коннектора | DONE | [phase4](phase4/report.md) — живой ингест SBER/TQBR |
| 5 | Мультиисточник: `V004` (`data_source` + `source_id`), сквозной `SourceId` | DONE | [phase5](phase5/report.md) — PK+source_id, нахлёст источников |
| 6a | Схема + запись: `V005` (coverage_segment), `V006` (connector_connection), `RecordingManager`, `CoverageStore` | DONE | [phase6a](phase6a/report.md) — сегменты покрытия, E2E `trade_count=500` |
| 6b | Control-plane сеть: хост → ASP.NET Core, REST + WebSocket, фабрика коннекторов, in-memory креды | TODO | — |
| 7 | Админ-фронт (React + Vite + TS): список инструментов, Гант, старт/стоп, управление подключениями | TODO | — |
| 8 | CI/CD: GitHub Actions (build + unit + integration) + compose-сервис `migrator` | TODO | — |
| 9 | Импорт истории QScalp `.qsh` (бэкфилл, `source=qscalp`) — поздний этап | TODO | — |

Порядок и зависимости: 4 → 5 → 6a → 6b → 7 (фронт можно начинать параллельно на моках) → 8 (можно рано) → 9.
Каждая фаза документируется как `phaseN/{plan,apply,report}.md` по общему шаблону.

---

## Stage 2. OrderLog / Plaza2 — *FUTURE*

Реализация Решения 5 из `db-design.md`: `md_orderlog` + `md_book_snapshot` (event sourcing), коннектор
Plaza2/CGate, деривация ленты/стакана. Стартует при появлении источника OrderLog (MOEX Plaza2).
Мультиисточник (`data_source`/`source_id`), ранее числившийся здесь, перенесён в Stage 1 (активирован
требованием «цвет = источник»).

## Связанные документы

- [apply.md](apply.md) — дизайн Stage 1 (OHS: управление записью + панель покрытия).
- [`../architecture/db-design.md`](../architecture/db-design.md) — решения по модели данных (Р1–Р5).
- [`../ohs.md`](../ohs.md) — обзор OHS.
- [`../solution/code.md`](../solution/code.md) — обзор кода vertical slice.
