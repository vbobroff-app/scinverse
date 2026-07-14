# Scinverse — стартовая точка (read me first)

> Этот файл — точка входа для нового чата/разработчика. Прочитай его — и поймёшь, что за проект,
> где что лежит и куда смотреть дальше. Исходный бриф-обоснование стека сохранён в конце
> ([Приложение](#приложение-исходный-prompt)).

## 1. Что это

**Scinverse** — платформа сбора, хранения, визуализации и анализа биржевых данных и торговли.
Клиент-серверная, сервис-ориентированная. Два контура:

- 🔴 **горячий (hot path)** — низколатентная торговля на **C#/.NET** (агенты в одном процессе с
  коннектором; данные идут напрямую, без Kafka в горячем пути);
- 🔵 **холодный (cold path)** — исследования/аналитика на **Python**, историчка в **TimescaleDB**,
  Kafka для асинхронной доставки и пост-трейд аналитики.

БД — **PostgreSQL + TimescaleDB**. UI — **только web** (React + WebGL/WebGPU), без отдельного
десктопа (обоснование — в [`concept.md`](./concept.md)).

Сейчас в разработке первый сервис — **OHS (Online History Server)**: online-сбор рыночных данных
через коннекторы (первый — Finam TRANSAQ) → нормализация → плотное хранение в TimescaleDB →
REST/WebSocket наружу + админ-фронт для управления записью и панели покрытия (Гант).

## 2. Карта репозитория

```
scinverse/
├─ README.md                     # обзор монорепо (+ mermaid)
├─ docs/                         # вся документация (docs-as-code) — см. §3
├─ db/Scinverse.Db.Migrator/     # DbUp-мигратор (SQL-first, V001…V00N)
└─ services/online-history-server/
   ├─ src/                       # backend (.NET 8)
   │  ├─ Scinverse.Ohs.Domain            # доменные модели/интерфейсы (InstrumentKey, MoexSchedule, …)
   │  ├─ Scinverse.Ohs.Contracts         # DTO + IOhsApi (контракт REST)
   │  ├─ Scinverse.Ohs.Ingestion         # нормализация/батчинг
   │  ├─ Scinverse.Ohs.Storage.Timescale # Npgsql COPY / Dapper (writers, stores)
   │  ├─ Scinverse.Ohs.Connectors.Transaq# коннекторы (TRANSAQ, SyntheticLive), фабрика, креды
   │  └─ Scinverse.Ohs.Host              # ASP.NET Core (Minimal API + /ws), композиционный корень
   ├─ tests/                     # UnitTests, IntegrationTests (Testcontainers), ApiTests
   └─ web/                       # admin frontend (React + TS + Vite + RxJS + Vitest)
      └─ src/{core,ui}           # core = framework-agnostic (RxJS), ui = React
```

## 3. Индекс документации

**Обзор и концепция**
- [`docs/concept.md`](./concept.md) — принятые архитектурные решения (почему web-only UI, что берём из legacy).
- [`docs/ohs.md`](./ohs.md) — назначение и модель OHS (коннектор → нормализация → хранилище → API).
- [`docs/gant.md`](./gant.md) — концепт быстрого Ганта (real-time progress bar, WebGL2 + LOD/Timescale
  CA); почему не DOM/canvas, выбор фреймворка, подводный камень zoom ⟂ проекция (реализация — phase 12).
- [`README.md`](../README.md) — обзор монорепо.

**Архитектура**
- [`docs/architecture/db-design.md`](./architecture/db-design.md) — решения по модели данных (Р1–Р5:
  нормализация, `derivative`, мультиисточник, OrderLog/Plaza2 и т.д.).
- [`docs/architecture/c4/arch.md`](./architecture/c4/arch.md) — C4-диаграммы (PlantUML), контекст/контейнеры.
- [`docs/architecture/ui-charting.md`](./architecture/ui-charting.md) — идеи по чартингу/UI.

**Код (обзор реализованного)**
- [`docs/solution/code.md`](./solution/code.md) — что реализовано по проектам (backend + frontend),
  схема БД (миграции), тесты. **Живой документ — держим в актуальном состоянии.**

**План разработки (Stages → фазы)**
- [`docs/dev/plan.md`](./dev/plan.md) — верхнеуровневая дорожная карта (Stage 0/1/2, таблица фаз, статусы).
- [`docs/dev/apply.md`](./dev/apply.md) — дизайн Stage 1 (управление записью + панель покрытия).
- [`docs/dev/phase7/roadmap.md`](./dev/phase7/roadmap.md) — **карта семейства фаз 7** (MVP админки): цели
  (интерфейс / прототип Ганта-разрывы / фундамент), таблица подфаз, текущий фокус. **Читать при работе по фазе 7.**
- [`docs/dev/phase7/mvp-to-release.md`](./dev/phase7/mvp-to-release.md) — швы MVP→release и известные
  сложности перехода (LOD/DOM/сессионная ось/caggs/сессии-таймзоны/креды).
- Каждая фаза — папка `docs/dev/phaseN/{plan,apply,report}.md`:
  - **plan** — цели/scope/критерии; **apply** — детали реализации/DDL/ссылки; **report** — статус/лог/итог.

**Статус фаз (Stage 1, OHS + admin frontend)**

| Фаза | Тема | Статус | Ссылка |
| ---- | ---- | ------ | ------ |
| 0,1,3 | Data foundation (миграции, V003, проверки) | DONE | [phase0](./dev/phase0/report.md) |
| 4 | Локальный E2E (живой ингест TRANSAQ) | DONE | [phase4](./dev/phase4/report.md) |
| 5 | Мультиисточник (V004, `source_id`) | DONE | [phase5](./dev/phase5/report.md) |
| 6a | Схема+запись (coverage_segment, RecordingManager) | DONE | [phase6a](./dev/phase6a/report.md) |
| 6b | Control-plane (REST + WS, фабрика коннекторов) | DONE | [phase6b](./dev/phase6b/report.md) |
| 6c | Иерархия деривативов (V007, группировки) | DONE | [phase6c](./dev/phase6c/report.md) |
| 7 | Админ-фронт (список, Гант, старт/стоп, подключения) | IN PROGRESS | [phase7](./dev/phase7/report.md) |
| 7b | Таймфреймы + сессионное окно (панель D/W/M/Q/Y/All/диапазон) | DONE | [phase7b](./dev/phase7b/report.md) |
| 7c | Реальное расписание MOEX (ISS) + страница «Биржи → Структура» | MVP DONE | [phase7c](./dev/phase7c/report.md) |
| 7d | Динамические фильтры каталога (плашки Инструмент/Выбор/Биржи + поиск справа) | MVP DONE | [phase7d](./dev/phase7d/report.md) |
| 7e | Управление подключениями (провайдеры): создание/креды/realtime-connect | MVP DONE | [phase7e](./dev/phase7e/report.md) |
| 7f | Тайм-лайн-фильтр оси + стандарт времени + вертикальный crosshair + подсветка дней | MVP DONE | [phase7f](./dev/phase7f/report.md) |
| 7g | Слой сделок на Ганте: присутствие торгов по бакетам (лесенка), app-кэш `V008`, `/coverage/activity` | DONE | [phase7g](./dev/phase7g/plan.md) |
| **7h** | **Честная подложка: recovery (`V009`), живость (`V010`/`V011`), автомат связи + пинг, красная разметка разрывов** | **DONE** | [phase7h/report](./dev/phase7h/report.md), [incident](./dev/phase7h/incident.md) |
| **7i** | **«Управление записью»: полуавтомат Auto + Supervisor (MOEX)** | **IN PROGRESS** | [phase7i/apply](./dev/phase7i/apply.md) |
| 8 | CI/CD (GitHub Actions + compose `migrator`) | TODO | — |
| 9 | Импорт истории QScalp `.qsh` | TODO | — |
| 10 | Multi-user & auth (Keycloak + `user_settings` + роли) | PLANNED | [phase10](./dev/phase10/plan.md) |
| 11 | Центр уведомлений (сквозная лента событий, нижний док, пакет → MFE позже) | IN PROGRESS | [phase11](./dev/phase11/plan.md) · [pkg](../packages/notification-center) |
| 12 | Гант-рендер: MVP → графический движок (WebGL2 + LOD/Timescale CA, real-time zoom/pan) | FUTURE | [phase12](./dev/phase12/plan.md) |

## 4. Ключевые доменные факты (быстрый ввод)

- **Инструмент** — `(ticker, board)`; мультиисточник: PK фактов включает `source_id`
  (одна бумага может иметь сделки из разных провайдеров — цвет колбаски = источник).
- **Деривативы** — таблица `derivative` (FUT/OPT), ленивое дерево на фронте: `фьючерс → серии
  (экспирации) → страйки`. Парсинг MOEX FORTS — `MoexFortsSpecParser`, нотация серий — `MoexSeries`.
- **Расписание MOEX** (`MoexSchedule` / фронтовый `moexSession.ts`): будни (ЕТС) **08:50–23:50**,
  доп. сессия выходного дня (с 01.03.2025) **09:50–19:00**; не каждые выходные (список исключений).
  **С 14.07.2026 СР/FORTS → 06:50–23:50** (moex.com/n101980) — хардкод дат-независим и станет неверным,
  реальные дат-зависимые часы подтянем из **ISS API** (phase 7c, см. [apply §3c](./dev/phase7c/apply.md)).
- **Таймлайн (Гант) — посессионная проекция** (`web/src/core/sessionProjection.ts`): ось делится
  по сессиям, ширина доли ∝ длительности торгов, неторговые разрывы схлопнуты в шов. Выходные
  **не схлопываем** — короче + подсветка (схлопывание станет опциональным фильтром). D/W/M/Q/Y и
  произвольный диапазон — все посессионные. Ось адаптивна по ширине (плотность подписей).
- **Тайм-лайн-фильтр оси** (phase 7f, `SessionFilter` + `OhsStore.timelineFilter$`): модель
  «Full + сессия» — `Full` тогглится независимо; режим сессии (`MOEX`/`custom`/`smart`) — группа.
  `Full + сессия` рисует день из зон `[pre | session | post]` (внесессионное приглушено), что
  наглядно показывает запись вне торгового окна. Сессия — **атрибут площадки**, не глобальная
  константа (задел под мультибиржу и дат-точные календари 7c). Проекция — чисто клиентская, поверх
  `sessions$`/`window$`.
- **Стандарт времени** (единый на систему, `displayTz$` = UTC/МСК/UTC+N) — вынесен в шапку. Ось и
  crosshair показывают время в нём; конец суток — `24:00` вместо `00:00`.
- **Вертикальный crosshair** (`crosshair.ts` + `CrosshairOverlay`) и **подсветка дней** (тумблер:
  каждый день в своём контейнере со скруглением + рамкой) — тумблеры в углах области Ганта.
- **Гант двухслойный** (phase 7g): тёмная подложка = «стояло на запись» (`coverage_segment`), яркие ячейки
  = реально была торговля (присутствие сделок по бакетам из `md_trade`). Бакет — временной промежуток
  (не пиксель); размер по **статической лесенке** (`bucketSecondsForTimeframe`, ~7 ступеней 30с…1д) —
  стабильный ключ кэша. Агрегация: TimescaleDB `time_bucket` **на лету** + свой app-кэш закрытых дней
  (`trade_activity_bucket`/`_computed`); continuous aggregates — на release (см. `mvp-to-release.md`).
- **Честная подложка / разрывы** (phase 7h, **DONE**) — модель трёх слоёв: **Намерение**
  (`coverage_segment`) ∩ **Живость** (`capture_liveness`: хартбит 15 c / пинг = «связь жива») даёт честный фон;
  дыра в живости внутри намерения = **обрыв связи** (красным), дыра в сделках при живой подложке =
  **тихий рынок** (не разрыв). Recovery на старте, автомат связи, WS `connectionStateChanged`.
  **Вне торговой сессии пинги не идут** — гейт в `LivenessProbe`. Справочник — [phase7h/incident.md](./dev/phase7h/incident.md);
  отчёт и сценарии проверки — [phase7h/report.md](./dev/phase7h/report.md).

## 5. Как запустить (локально)

- **БД:** TimescaleDB из `docker-compose` (образ запинен), миграции — DbUp (`db/Scinverse.Db.Migrator`).
- **Backend (OHS host):** запускается из Visual Studio или `dotnet run` (`Scinverse.Ohs.Host`);
  секреты/DLL-путь — в неверсионируемом `appsettings.Local.json`.
- **Frontend:** `services/online-history-server/web` → `pnpm install`, `pnpm dev` (Vite,
  проксирует `/api` и `/ws` на хост). Тесты — `pnpm exec vitest run`, типы — `pnpm exec tsc --noEmit`.
- **Backend-тесты:** `dotnet test` (integration/api требуют Docker — Testcontainers).

## 6. Конвенции

- **Docs-as-code:** каждая фаза — `plan/apply/report.md`; решения по данным — в `db-design.md`.
- **Именование** — по Visual Studio/ReSharper; C# 12 (primary constructors), `LangVersion=12`.
- **Коммиты:** формат `feat(ohs-<phase>): …`; коммитит пользователь, ассистент готовит message.
- **SQL-first:** миграции DbUp (`V00N__*.sql`), чтение — Dapper, массовая запись — Npgsql COPY.
- **Frontend:** `core/` — без React (RxJS `BehaviorSubject`-стор + API/WS), `ui/` — тонкий React-слой
  (хуки `useObservable`/`useBehavior`). Тёмная тема (вдохновлено `scrider-editor`).

## 7. Текущий момент и следующие шаги

**Область Ганта собрана.** Завершены: посессионная ось (7b), фильтры каталога (7d), провайдеры (7e),
тайм-лайн-фильтр + TZ (7f), слой сделок (7g), **честная подложка и разрывы (7h)** — валидировано на Finam.

Карта фазы 7 — [phase7/roadmap.md](./dev/phase7/roadmap.md).

---

## 8. ➡️ НОВЫЙ ЧАТ: phase 7i — «Управление записью» (полуавтомат Auto)

**Прочитай первым:** [docs/dev/phase7i/plan.md](./dev/phase7i/plan.md) · [apply.md](./dev/phase7i/apply.md)

### Задача (MVP-срез)

Рядом со **Старт/Стоп** — switcher **Auto** (тот же `StatusSwitch`, что у подключений).
При Auto on Supervisor сам жмёт Старт/Стоп по сессии MOEX FORTS.

| Auto | Цвет | Смысл |
|------|------|--------|
| off | серый | не контролирует |
| on, вне сессии | зелёный | вооружён, включит по времени |
| on, пишет | голубой | пишет (темп сделок не важен) |
| on, ждёт связи | жёлтый middle | в работе, жду связи |

Override: ручной Стоп → Auto off. Стоп одного в серии → у него запись+Auto off, у соседей только Auto off.

### Почему 7h — обязательная база

| Компонент 7h | Роль для 7i |
|--------------|-------------|
| `ConnectionManager` + автомат связи | авто-connect / reconnect / ре-подписка |
| `RecordingManager.StartAsync` / `StopAsync` | arm/disarm записи Supervisor'ом |
| `LivenessProbe` + гейт торговых часов | **вне сессии пинги не идут**, живость не пишется — Supervisor должен **не вооружать** запись вне окна |
| `IMarketCalendar` / ISS (7c) | часы сессии площадки для «должен ли писать сейчас?» |
| Честная подложка | вне окна — нейтральный фон (не ложная дыра) |

### Планируемая модель (из plan.md)

- Таблица `recording_schedule` (instrument_id, connection_id, mode, weekdays, window_kind, warmup…).
- `RecordingSupervisor` — фоновый тик ~1 мин, идемпотентный arm/disarm.
- API: `GET/PUT /api/recording/schedule`.
- UI: диалог «Управление записью» вместо Старт/Стоп; индикатор `пишет` / `вооружён` / `вне сессии` / `выкл`.
- US-инструменты — IANA tz (`America/New_York`), DST.

### Открытый вопрос (решить на живом Finam)

Источник «сейчас торгуется»: (1) TRANSAQ `inst.active`, (2) эмпирика `md_trade`, (3) календарь 7c/ISS.
Вероятный гибрид — см. конец [phase7i/plan.md](./dev/phase7i/plan.md).

### Ключевые файлы (точки входа)

**Backend (расширять):**
- `Scinverse.Ohs.Host/RecordingManager.cs` — start/stop, `OnLinkLiveAsync`
- `Scinverse.Ohs.Host/ConnectionManager.cs` — connect/disconnect, link automaton
- `Scinverse.Ohs.Host/LivenessProbe.cs` — гейт сессии (не дублировать логику — переиспользовать `IMarketCalendar`)
- `Scinverse.Ohs.Host/MarketCalendar.cs` — ISS-календарь FORTS
- `Scinverse.Ohs.Host/OhsWorker.cs` — зарегистрировать Supervisor рядом с `LivenessProbe`
- `db/migrations/V012__…` — `recording_schedule` (имя уточнить в apply)

**Frontend (менять):**
- `web/src/ui/components/InstrumentPicker.tsx` — Старт/Стоп → «Управление записью»
- `web/src/core/OhsStore.ts` — schedule state, команды API
- `web/src/core/api.ts` + `types.ts` — DTO расписания

**Документация (создать по ходу):**
- `docs/dev/phase7i/{apply,report}.md` — apply при реализации

### Что уже сделано вне 7i (не ломать)

- Ручной старт/стоп работает (`RecordingManager`, кнопки в `InstrumentPicker`).
- Finam `connection_id=3`, `source_id=1`; креды временно в `appsettings.Local.json` (`DevLocalTransaqCredentials`).
- Звёздочки инструментов — `localStorage` (`selectedInstrumentsStorage.ts`).
- Фикс reconnect после Down: `ConnectAsync` сбрасывает осиротевшую сессию; фронт: `disconnected` на connect → error.

### Критерии приёмки 7i (кратко)

1. `scheduled` — сам старт/стоп по сессии; ночью запись не идёт.
2. `manual` — как сейчас; ручной старт перекрывает расписание.
3. US-tz с DST.
4. Вне окна — нейтральный фон Ганта.
5. Тесты зелёные.

### Запуск для разработки

```text
БД: docker-compose + DbUp (миграции до V011)
Host: Scinverse.Ohs.Host (:5080), appsettings.Local.json для Transaq
Web:  services/online-history-server/web → pnpm dev
Тесты: dotnet test; pnpm exec vitest run; pnpm exec tsc --noEmit
```

### Соседние фазы (не смешивать с 7i)

- **7e follow-up:** статус инструмента по борду (7c.9), тесты credentials — отдельно.
- **8** CI/CD, **9** qsh backfill, **10** multi-user — позже.

---

## 9. Справка: провайдеры (phase 7e, DONE)

Управление подключениями из админки — [phase7e/report.md](./dev/phase7e/report.md).

- `ConnectionForm`, `ConnectionToggle` (5 фаз + error), `ProviderCard`
- Backend: `ConnectionManager`, `POST /connections/validate`, synthetic + Transaq
- Эмуляция обрыва: `POST /api/connections/{id}/debug/drop` (Dev, synthetic)

---

## 10. Справка: ISS / биржи (phase 7c, MVP DONE)

Реальный календарь MOEX — [phase7c/report.md](./dev/phase7c/report.md). Для 7i переиспользовать
`IMarketCalendar.ShapeSessionsAsync(engine, dates)` — уже питает `/api/sessions` и гейт `LivenessProbe`.

---

## Приложение: исходный prompt

> Ниже — первоначальный бриф, с которого стартовало проектирование (обоснование выбора стека).
> Актуальные решения см. в [`concept.md`](./concept.md) и [`dev/plan.md`](./dev/plan.md).

Хочу начать проектировать систему анализа и построения торговых систем. Опыт — WealthLab, BackTrader
на Python и мультиброкер от Игоря Чечета. Система будет представлять собой клиент-серверное
приложение, коннекторы к брокерам и поставщикам данных, визуализация, аналитика, торговля. Стек:
Frontend — React + WebGL; серверная часть — микросервисы на Python и C#; база — PostgreSQL.

Резюме по стеку:

| Компонент | Технология | Обоснование |
| :--- | :--- | :--- |
| Языки | Python (стратегии/аналитика) + C# (высоконагруженные сервисы) | Опыт BackTrader + производительность/надёжность C# на критических путях. |
| База данных | PostgreSQL + TimescaleDB | Реляционная СУБД + сверхбыстрое расширение для временных рядов. |
| API / Бэкенд | FastAPI (Python), ASP.NET Core (C#), API Gateway | Быстрые современные фреймворки для микросервисов. |
| Визуализация | React + WebGL | Высокая производительность, поддержка React, готовый функционал для трейдинга. |
| Сообщения | Apache Kafka | Стандарт потоковой передачи и асинхронного обмена в финсистемах. |
| Мониторинг | Prometheus + Grafana + Jaeger | Наблюдаемость распределённой системы. |
