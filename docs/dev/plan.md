# План разработки Scinverse — верхний уровень

Дорожная карта по сервису OHS/ODS. Работа сгруппирована в **Stages** (крупные темы), каждый Stage
состоит из **фаз** (`phaseN`) со сквозной нумерацией. Архитектурные решения по модели данных — в
[`../architecture/db-design.md`](../architecture/db-design.md); дизайн Stage 1 — в [apply.md](apply.md).

Статусы: **TODO** — не начато; **IN PROGRESS** — в работе; **DONE** — завершено.

## Stages

| Stage | Тема | Фазы | Статус |
| ----- | ---- | ---- | ------ |
| 0 | Data foundation: создание БД / инфраструктура миграций | phase0, phase1, phase3 | DONE |
| 1 | OHS apply + admin frontend: управление записью + панель покрытия (Гант) | phase4–phase10 | IN PROGRESS |
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
**[apply.md](apply.md)**. Семейство фаз 7 (`7`, `7b`–`7i`) — прототипный MVP админки; его цели, карта
подфаз и текущий фокус (разрывы) собраны в **[phase7/roadmap.md](phase7/roadmap.md)**, а швы и сложности
перехода MVP→release — в **[phase7/mvp-to-release.md](phase7/mvp-to-release.md)**.

| Фаза | Содержание | Статус | Детали |
| ---- | ---------- | ------ | ------ |
| 4 | Локальный E2E OHS (запись): смоук (fake) + реальный TRANSAQ, отладка коннектора | DONE | [phase4](phase4/report.md) — живой ингест SBER/TQBR |
| 5 | Мультиисточник: `V004` (`data_source` + `source_id`), сквозной `SourceId` | DONE | [phase5](phase5/report.md) — PK+source_id, нахлёст источников |
| 6a | Схема + запись: `V005` (coverage_segment), `V006` (connector_connection), `RecordingManager`, `CoverageStore` | DONE | [phase6a](phase6a/report.md) — сегменты покрытия, E2E `trade_count=500` |
| 6b | Control-plane сеть: хост → ASP.NET Core, REST (Minimal API + контракт `IOhsApi`) + WebSocket, фабрика коннекторов, in-memory креды | DONE | [phase6b](phase6b/report.md) — 31 тест, живой хост отвечает |
| 6c | Иерархия инструментов: наполнение `derivative` (`V007`), read-model группировки (`/api/instruments/groups`), фильтры цепочки | DONE | [phase6c](phase6c/report.md) — питает фильтры каталога (дерево descoped) |
| 7 | Админ-фронт (React + Vite + TS): список инструментов, Гант, старт/стоп, управление подключениями | IN PROGRESS | [phase7](phase7/report.md) — ур.3 готов; далее ур.2/ур.1 (дерево снято, см. [issue](phase7/issue.md)) |
| 7b | Таймфреймы и сессионное окно: панель `D/W/M/Q/Y/All/диапазон`, сессионная модель MOEX, сепараторы сессий | DONE | [phase7b](phase7b/report.md) — `/api/sessions`, `/api/coverage/extent`, `TimeframePanel` + `DateRangePicker` |
| 7c | Реальное расписание MOEX (ISS): производств. календарь + `session_schedule`, страница «Биржи → Структура» (движки/рынки/борды/инструменты) | PLANNED | [phase7c](phase7c/report.md) — ISS-клиент, кэш `V008`, fallback `MoexSchedule` |
| 7d | Динамические фильтры каталога: плашки (Инструменты/Выбор/Биржи) + `[+]`/`[×]`, поиск справа; бэкенд-фильтры `nonEmpty`/`instrumentIds`/`exchanges` | IN PROGRESS | [phase7d](phase7d/report.md) — chips-паттерн (как `mars`), рефактор `FilterBar` |
| 7e | Управление подключениями: UI создания/редактирования коннектора (Transaq), ввод кред, realtime-connect | PLANNED | [phase7e](phase7e/report.md) — форма над control-plane (phase 6b), бэкенд уже готов |
| 7f | Тайм-лайн-фильтр оси Ганта (дни + окно дня) + единый стандарт времени (UTC/МСК/UTC+N) в шапке | MVP DONE | [phase7f](phase7f/report.md) — сессия = атрибут площадки; проекция на клиенте; задел под 7c/мультибиржу |
| 7g | Слой сделок на Ганте: присутствие торгов по бакетам (статическая лесенка), app-кэш `V008`, `/coverage/activity` | DONE | [phase7g](phase7g/plan.md) — двухслойный Гант: подложка записи + яркие ячейки сделок |
| 7h | Честная подложка: recovery осиротевших (`V009`), живость захвата (`V010` `capture_liveness`), автомат связи + пинг, красная разметка обрывов | IN PROGRESS | [phase7h](phase7h/plan.md) — 7h.0/7h.1 done (фундамент); далее пинг/`server_status`/UI |
| 7i | «Управление записью»: расписание автозаписи (Supervisor) — авто-connect → запись в сессию площадки → авто-stop; мультибиржа/US-tz | PLANNED | [phase7i](phase7i/plan.md) — заменяет ручные Старт/Стоп; решает «фон ночью» |
| 8 | CI/CD: GitHub Actions (build + unit + integration) + compose-сервис `migrator` | TODO | — |
| 9 | Импорт истории QScalp `.qsh` (бэкфилл, `source=qscalp`) — поздний этап | TODO | — |
| 10 | Multi-user & auth: Keycloak (OIDC/JWT для .NET+Python), таблица `user_settings`, примитивные роли | PLANNED | [phase10](phase10/plan.md) — единая identity, настройки в своём Postgres |
| 11 | Центр уведомлений: сквозная лента событий (severity Info/Warning/Critical/Error × тип User/System/External), нижний док, MFE | PLANNED | [phase11](phase11/plan.md) — singleton-шина (RxJS) + WS `notification` + бэклог |
| 12 | **Гант-рендер: MVP → настоящий графический движок** — WebGL2 (regl/Pixi) + LOD-агрегация (Timescale continuous aggregates), real-time zoom/pan | FUTURE | [phase12](phase12/plan.md) — крупная веха; стартует, когда «быстрая графика» станет узким местом (сотни инструментов на записи) |
| 13 | **Кэширование (сквозное)** — единый слой кэша для всей системы (не только ISS): персистентный/распределённый бэкенд, stale-on-error + refresh-ahead, политики TTL/инвалидации по видам данных, метрики hit/miss | PLANNED | [phase13](phase13/plan.md) — обобщает in-memory ISS-кэш (7c) в сквозную инфраструктуру |

Порядок и зависимости: 4 → 5 → 6a → 6b → 7 (фронт можно начинать параллельно на моках); 6c
вклинивается между итерациями phase7 (даёт иерархию деривативов; отдельный «древовидный» вид
descoped — навигация по структуре решается фильтрами 7d, `groups` питает значения фильтра); 7b расширяет phase7
(управление окном Ганта); 7c заменяет эвристику расписания на реальные данные MOEX ISS и добавляет
страницу «Биржи → Структура»; 7d добавляет динамические фильтры-плашки каталога (параллельно 7c);
7e даёт UI управления подключениями (Transaq realtime) поверх готового control-plane (phase 6b);
7f расширяет ось Ганта тайм-лайн-фильтром (дни + окно дня) и выносит стандарт времени в шапку —
чистая клиентская проекция поверх `sessions$`/`window$` (phase 7b), сессия = атрибут площадки
(задел под 7c: реальные календари/дат-точные расписания, и под мультибиржу Finam/CME) → 8 (можно
рано) → 9. Фаза 10 (multi-user & auth на Keycloak + `user_settings` + роли) — сквозная
по всей системе (.NET горячий + Python холодный контуры валидируют один OIDC-токен), стартует
независимо, когда потребуется многопользовательский режим. Фаза 11 (центр уведомлений — сквозная
лента событий, нижний док, MFE) — тоже сквозная: singleton-шина (RxJS) поверх WS-транспорта
(phase 6b), персистенция состояния — при наличии phase 10; стартует независимо.
Фаза 12 (Гант-рендер: WebGL2 + LOD) — отдельная крупная веха перехода от MVP-отрисовки (DOM-колбаски)
к настоящему графическому движку с real-time zoom/pan; приоритет низкий («быстрая графика — на потом»),
стартует, когда DOM-рендер станет узким местом. LOD-агрегация (Timescale continuous aggregates) —
фундамент, ортогональный выбору рендерера. Детали и открытые решения (режим оси при зуме) — в
[phase12/plan.md](phase12/plan.md).
Фаза 13 (кэширование — сквозное) — тоже независимая инфраструктурная веха: обобщает точечный
in-memory-кэш ISS (phase 7c, `IssExchangeCatalog`/`IMemoryCache`) в единый слой для всей системы
(ISS-структура/расписания, read-model'и каталога, тяжёлые агрегаты и т.п.). Ключевое —
персистентность (переживает рестарт Host), опционально распределённость (общий кэш между инстансами),
`stale-on-error` (отдаём последнюю валидную копию, когда апстрим недоступен) и `refresh-ahead`
(фоновое обновление до истечения TTL). Стартует независимо, когда флаки-апстримы/рестарты/нагрузка
станут ощутимы; частично снимает `TODO (7c.3)` о персистентном кэше. Детали — в [phase13/plan.md](phase13/plan.md).
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
