# План разработки Scinverse — верхний уровень

Дорожная карта по сервису OHS/ODS.

- **Stages** — крупные темы и gate'ы (`stageN/main.md`). Каркас не ломаем (1→2→3→4).
- **Phases** — хроника MVP / планы фаз, archive в [`dev/`](dev/main.md) (`phaseN`, пути стабильны).
- **Features** — параллельный продуктовый backlog после Stage 1: [`features/main.md`](features/main.md).
  Сквозные тонкие срезы (UI→Host→NC…), а не «сначала вся область → потом соседние контуры».
  Так раньше появляется рабочий функционал и меньше риск застрять на ширине (см. § «Зачем фичи»
  в features/main).

Архитектура данных — [`architecture/db-design.md`](architecture/db-design.md);
дизайн Stage 1 — [`stage1/apply.md`](stage1/apply.md).
Handoff — [`promt.md`](promt.md).

Статусы: **TODO** — не начато; **IN PROGRESS** — в работе; **DONE** — завершено;
**FUTURE** — вне текущего горизонта закрытия.

## Stages

| Stage | Тема | Фазы | Статус | Индекс |
| ----- | ---- | ---- | ------ | ------ |
| 0 | Data foundation: БД / миграции | phase0–phase3 | DONE | [stage0](stage0/main.md) |
| 1 | OHS apply + admin frontend MVP | phase4–phase8 | **DONE** | [stage1](stage1/main.md) |
| 2 | Multi-user & auth + split сервисов | phase10–phase11 | PLANNED | [stage2](stage2/main.md) |
| 3 | Гант-рендер WebGL2 + LOD | phase12 | FUTURE | [stage3](stage3/main.md) |
| 4 | Сквозное кэширование + CI/CD | phase13–phase14 | PLANNED | [stage4](stage4/main.md) |

**Future Features** (вне Stages): QScalp `.qsh`, OrderLog / Plaza2 — см. § ниже.

Хвосты Stage 1 (вне MVP) — **[stage1/abandoned.md](stage1/abandoned.md)**.  
Параллельные доработки — **[features/main.md](features/main.md)**.

---

## Stage 0. Data foundation (DB) — *DONE*

Фундамент данных: инфраструктура миграций (DbUp), базовая схема и проверки.
Индекс: [stage0/main.md](stage0/main.md).

| Фаза | Содержание | Объём | Статус | Детали |
| ---- | ---------- | ----- | ------ | ------ |
| 0 | Инфраструктура миграций: накат на compose-БД, воспроизводимость | Полностью, вариант A | DONE | [phase0/](dev/phase0/plan.md) |
| 1 | Миграция `V003` (derivative + instrument_risk) | Только `V003` | DONE | [phase1/](dev/phase1/plan.md) |
| 3 | Проверки (build + unit + integration) | В необходимом объёме | DONE | [phase3/](dev/phase3/plan.md) |

### Фаза 0. Инфраструктура миграций — *DONE*

Мигратор (`db/Scinverse.Db.Migrator`, DbUp) уже реализован. Задача фазы — накатить существующие
миграции (`V001`, `V002`) на TimescaleDB из `docker-compose`, закрепить воспроизводимость
(пиннинг образа) и добавить удобную обвязку запуска. Подробно — в [phase0/plan.md](dev/phase0/plan.md),
особенности реализации — в [phase0/apply.md](dev/phase0/apply.md), статус — в [phase0/report.md](dev/phase0/report.md).

**Итог:** образ закреплён `2.17.2-pg16`; `V001`+`V002` накатаны на локальную TimescaleDB; схема
верифицирована (hypertable, индексы, журнал); повтор идемпотентен. По ходу устранён конфликт версий
`Npgsql` ↔ `dbup-postgresql` (net8 требует Npgsql 9) — `Npgsql` поднят до `9.0.3`.

### Фаза 1. Миграция V003 (derivative + instrument_risk) — *DONE*

Реализация Решения 2 из `db-design.md`: подтип-таблица `derivative` (атрибуты FUT/OPT, 1:1 с
`instrument`, индекс цепочки опционов) и темпоральная `instrument_risk` (ГО/лимиты с историей).
Аддитивная миграция, риска для существующих данных нет. Подробно — в [phase1/plan.md](dev/phase1/plan.md),
DDL — в [phase1/apply.md](dev/phase1/apply.md), статус — в [phase1/report.md](dev/phase1/report.md).

### Фаза 3. Проверки — *DONE*

`dotnet build` + unit-тесты + интеграционные (Testcontainers) на актуальной схеме. Подробно — в
[phase3/plan.md](dev/phase3/plan.md), детали — в [phase3/apply.md](dev/phase3/apply.md), статус — в
[phase3/report.md](dev/phase3/report.md).

**Итог:** unit 20/20, integration 4/4. Проверки поймали регрессию апгрейда Npgsql 8→9 (запись
`timestamptz` требует UTC) — исправлено в `TimescaleTradeWriter` (`ToUniversalTime()`).

---

## Stage 1. OHS apply + admin frontend MVP — *DONE*

Превращаем OHS из «воркера на статическом конфиге» в управляемый сервис записи с админ-панелью:
пользователь выбирает инструмент и ведёт online-запись через коннектор, а Гант показывает «колбаски»
покрытия данными (цвет = источник), растущие в реальном времени, с видимыми разрывами. Полный дизайн
Stage 1 — в **[stage1/apply.md](stage1/apply.md)**. Семейство фаз 7 (`7`, `7b`–`7j`) — прототипный MVP админки;
карта подфаз — **[phase7/roadmap.md](dev/phase7/roadmap.md)**.
Индекс: [stage1/main.md](stage1/main.md).

**Закрыто 2026-08-04.** Рабочий монолит Host + Admin web + журнал инцидентов OHS (phase 8).
Без выноса сервисов, без Keycloak, без WebGL, без CI на стенды.
Хвосты для дальнейшей (production) реализации — **[stage1/abandoned.md](stage1/abandoned.md)**.

**Каталог Online (после close Stage 1, не Stage 2):** `7h.OPT` / `7i.OPT` — **DONE**
(ATM ±N FORTS, Refresh UX + NC Action/Checkup, суточный Lifecycle, `instrument.active` = архив по exp).
Канон — [wiki-readme/catalog.md](wiki-readme/catalog.md) · [phase7i/issue.md](dev/phase7i/issue.md).
Остаток по спискам — intraday «торгуется» (**7c.9** / **7c.SEC** в abandoned) и
фича baskets/Observed ([catalog-basket-instruments](features/catalog-basket-instruments/main.md));
это **не** gate Stage 2.

| Фаза | Содержание | Статус | Детали |
| ---- | ---------- | ------ | ------ |
| 4 | Локальный E2E OHS (запись): смоук (fake) + реальный TRANSAQ | DONE | [phase4](dev/phase4/report.md) |
| 5 | Мультиисточник: `V004` (`data_source` + `source_id`) | DONE | [phase5](dev/phase5/report.md) |
| 6a | Схема + запись: `V005`/`V006`, `RecordingManager`, `CoverageStore` | DONE | [phase6a](dev/phase6a/report.md) |
| 6b | Control-plane: ASP.NET Core, REST + WebSocket | DONE | [phase6b](dev/phase6b/report.md) |
| 6c | Иерархия инструментов: `derivative` (`V007`), groups | DONE | [phase6c](dev/phase6c/report.md) |
| 7 | Админ-фронт: каталог, Гант, старт/стоп (ур.3 MVP) | DONE | [phase7](dev/phase7/report.md) |
| 7b | Таймфреймы и сессионное окно | DONE | [phase7b](dev/phase7b/report.md) |
| 7c | Расписание MOEX (ISS) + «Биржи → Структура» | MVP DONE | [phase7c](dev/phase7c/report.md) |
| 7d | Динамические фильтры каталога | MVP DONE | [phase7d](dev/phase7d/report.md) |
| 7e | Управление подключениями (Transaq UI) | MVP DONE | [phase7e](dev/phase7e/report.md) |
| 7f | Тайм-лайн-фильтр оси Ганта + стандарт времени | MVP DONE | [phase7f](dev/phase7f/report.md) |
| 7g | Слой сделок на Ганте (`/coverage/activity`) | DONE | [phase7g](dev/phase7g/plan.md) |
| 7h | Честная подложка + liveness + **Write Gaps** (+ OPT ATM Online) | DONE | [phase7h](dev/phase7h/report.md) · OPT → [7i/issue](dev/phase7i/issue.md) |
| 7i | Auto / Supervisor + `market_schedule` + Integrations + **OPT/Refresh/lifecycle** | MVP DONE | [phase7i](dev/phase7i/report.md) |
| 7j | Расписание соединения + инциденты v2 + abandon | MVP DONE | [phase7j](dev/phase7j/report.md) |
| **8** | **Журнал `incident`, soft-delete, ribbon, crash fan-out** | DONE | [phase8](dev/phase8/plan.md) |

NC-пакет / Thread / вынос MFE — **Stage 2 / phase 11**, не Stage 1.
Online-каталог опционов / Refresh / архив по exp — **уже в Stage 1** (не долг Stage 2).

---

## Stage 2. Multi-user & auth + разделение сервисов — *PLANNED*

Auth и вынос из монолита: отдельные деплои **OHS**, **Admin Front**, **Notification Center**.
C4 — [`architecture/c4/arch.md`](architecture/c4/arch.md). Индекс: [stage2/main.md](stage2/main.md).

| Фаза | Содержание | Статус | Детали |
| ---- | ---------- | ------ | ------ |
| 10 | Multi-user & auth: Keycloak (OIDC/JWT), `user_settings`, примитивные роли | PLANNED | [phase10](dev/phase10/plan.md) |
| 11 | **NC как продукт** + **split** OHS / Admin Front / NC (MFE, отдельные деплои) | PLANNED | [phase11](dev/phase11/plan.md) |

**Gate перед Stage 3 (phase 12):** Keycloak на API/UI; Admin Front и NC вынесены; OHS остаётся
data/control-plane. Product Front / ODS — следующий горизонт (не блокер этого gate).

| Контур | К gate (вынос) | После выноса |
| --- | --- | --- |
| **OHS** | Функционал write/control + журнал (Stage 1 / phase 8) стабилен | JWT Keycloak |
| **Admin Front** | MVP монолита достаточен для выноса | WebGL (phase 12) + NC MFE |
| **NC** | Пакет + шина в монолите (база уже есть) | Отдельный сервис, MFE remote |
| **Keycloak (10)** | Включён в gate | Штатный issuer |

---

## Stage 3. Гант-рендер WebGL — *FUTURE*

Индекс: [stage3/main.md](stage3/main.md).

| Фаза | Содержание | Статус | Детали |
| ---- | ---------- | ------ | ------ |
| 12 | Гант: MVP DOM → WebGL2 + LOD (на вынесенном Admin Front) | FUTURE | [phase12](dev/phase12/plan.md) |

Стартует **только после** gate Stage 2. LOD (Timescale caggs) ортогонален рендереру.
Концепт — [`architecture/ui-charting.md`](architecture/ui-charting.md) / [`gant.md`](gant.md).

---

## Stage 4. Инфраструктура (кэш + CI/CD) — *PLANNED*

Индекс: [stage4/main.md](stage4/main.md).

| Фаза | Содержание | Статус | Детали |
| ---- | ---------- | ------ | ------ |
| 13 | Сквозное кэширование (не только ISS): L1/L2, stale-on-error, TTL/инвалидация | PLANNED | [phase13](dev/phase13/plan.md) |
| 14 | CI/CD: GitHub Actions при публикации сервиса на стенд/prod (не для локального MVP) | TODO | [phase14](dev/phase14/plan.md) |

**Критерий phase 14:** пайплайн нужен, когда сервис (начиная с NC или Admin Front) публикуется
в org-стенд/prod — не для локального монолита Stage 1.

---

## Future Features

Вне текущих Stages закрытия. Нет отдельных `phase9/*` папок — только регистрация здесь.
(Не путать с [`features/`](features/main.md) — рабочим backlog после Stage 1.)

| Тема | Бывший номер / источник | Содержание | Статус |
| ---- | ----------------------- | ---------- | ------ |
| **QScalp `.qsh`** | phase 9 | Импорт истории (бэкфилл), `source=qscalp` | FUTURE |
| **OrderLog / Plaza2** | Stage 2 (старый) | `md_orderlog` + `md_book_snapshot`, коннектор Plaza2/CGate (Решение 5 `db-design`) | FUTURE |

**QScalp.** Поздний бэкфилл ленты сделок из файлов `.qsh` в `md_trade` с отдельным `source_id`.
Не блокер Stage 1–3.

**OrderLog / Plaza2.** Реализация Решения 5 из `db-design.md`: event sourcing стакана/ордерлога,
коннектор Plaza2/CGate, деривация ленты. Стартует при появлении источника OrderLog (MOEX Plaza2).
Мультиисточник (`data_source`/`source_id`) уже в Stage 1 (phase 5).

---

## Связанные документы

- [`stage1/apply.md`](stage1/apply.md) — дизайн Stage 1 (OHS: управление записью + панель покрытия).
- [`stage1/abandoned.md`](stage1/abandoned.md) — хвосты Stage 1 вне MVP (OPT/Refresh **сняты**).
- [`features/main.md`](features/main.md) — параллельные фичи после MVP.
- [`wiki-readme/catalog.md`](wiki-readme/catalog.md) — Online-каталог / ATM / Refresh / архив.
- [`architecture/db-design.md`](architecture/db-design.md) — решения по модели данных (Р1–Р5).
- [`ohs.md`](ohs.md) — обзор OHS.
- [`solution/code.md`](solution/code.md) — обзор кода vertical slice.
- [`architecture/c4/arch.md`](architecture/c4/arch.md) — to-be C4 (split сервисов).
- [`dev/main.md`](dev/main.md) — archive фаз.
