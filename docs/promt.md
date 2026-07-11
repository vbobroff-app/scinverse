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
| 7c | Реальное расписание MOEX (ISS) + страница «Биржи → Структура» | PLANNED | [phase7c](./dev/phase7c/report.md) |
| 7d | Динамические фильтры каталога (плашки Инструмент/Выбор/Биржи + поиск справа) | IN PROGRESS (UI готов, тесты) | [phase7d](./dev/phase7d/report.md) |
| **7e** | **Управление подключениями (провайдеры): создание/креды/realtime-connect** | **IN PROGRESS (UI готов; realtime + тесты)** | [phase7e](./dev/phase7e/report.md) |
| 7f | Тайм-лайн-фильтр оси + стандарт времени + вертикальный crosshair + подсветка дней | MVP DONE | [phase7f](./dev/phase7f/report.md) |
| 8 | CI/CD (GitHub Actions + compose `migrator`) | TODO | — |
| 9 | Импорт истории QScalp `.qsh` | TODO | — |
| 10 | Multi-user & auth (Keycloak + `user_settings` + роли) | PLANNED | [phase10](./dev/phase10/plan.md) |
| 11 | Центр уведомлений (сквозная лента событий, нижний док, MFE) | PLANNED | [phase11](./dev/phase11/plan.md) |

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

**Область Ганта фактически собрана.** Завершены: посессионная ось + таймфреймы D/W/M/Q/Y/диапазон
(phase 7b), тайм-лайн-фильтр «Full + сессия» + единый стандарт времени в шапке, вертикальный
crosshair, подсветка дней (phase 7f — MVP DONE). Динамические фильтры каталога (плашки
Инструмент/Выбор/Биржи + поиск) — реализованы (phase 7d, остались тесты). Footer готов.

### ➡️ Следующий блок (для нового чата): ПРОВАЙДЕРЫ — [phase 7e](./dev/phase7e/plan.md)

Управление подключениями (провайдерами) к источникам данных из админки.

**Что уже готово (7e.1–7e.5, UI-слой):**
- Форма создания/редактирования подключения `ConnectionForm` (`kind = transaq | synthetic`, source,
  settings, логин/пароль в попапе), кнопка `+` в `ConnectionsPanel`.
- Тумблер статуса `ConnectionToggle`: 4 состояния цветом — Отключен (серый) → Подключение (жёлтый) →
  Подключён Актив. (синий, идут данные) → Подключён Ожид. (зелёный, тишина ≥5 c); error = красный.
  Активность/ожидание решает **бэкенд** (`ConnectionManager` по потоку данных коннектор→биржа).
- Редактирование/удаление провайдера: ПКМ-меню (✎/✕) + `ConfirmDialog`; backend
  `PUT`/`DELETE /connections/{id}` (удаление гасит сессию и чистит креды; факты в БД остаются).
- `synthetic-local` эмулирует флоу для демо: Connecting (2–3 c) → Waiting (5 c) → Active.

**Что осталось по провайдерам (задачи нового чата):**
1. **Реальный Transaq realtime-connect с живого рынка** — креды/DLL-путь, проверить подключение и
   рост колбасок на реальных торгах (в т.ч. сценарий выходных торгов MOEX).
2. **Тесты 7e.6** — vitest на команды `OhsStore` (upsert/credentials/test → вызов api + merge),
   опц. api-smoke на upsert+credentials (секреты не должны попадать в `connections$`/ответы API).
3. **Статус инструмента по расписанию борда** в карточке (Открыто/Закрыто/Пре-опен) — авторитетно,
   не lagging; для записываемых — «активность записи» по времени последней сделки (порог ~30 c).
   Завязано на [phase 7c](./dev/phase7c/plan.md).

**Код провайдеров:** backend — `Scinverse.Ohs.Connectors.Transaq` (коннекторы TRANSAQ/SyntheticLive,
фабрика, `ConnectionManager`, `ICredentialStore`), control-plane REST/WS — `Scinverse.Ohs.Host`
(phase 6b). Frontend — `web/src/ui/pages/{ConnectionsPanel,ProviderCard}`,
`web/src/ui/components/{ConnectionForm,ConnectionToggle}`, команды — `web/src/core/OhsStore.ts`.
Детали фазы — [phase7e/{plan,apply,report}.md](./dev/phase7e/report.md).

**Крупный задел рядом:** [phase 7c](./dev/phase7c/plan.md) — интеграция MOEX ISS API: реальное
расписание торгов, страница «Биржи → Структура» (движки/рынки/борды + торгуемые инструменты) и
**лента новостей/событий**. Все ссылки на ISS-эндпоинты — в [phase7c/apply.md](./dev/phase7c/apply.md).

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
