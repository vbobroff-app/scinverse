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
├─ docs/                         # docs-as-code — см. §3; вход нового чата = docs/promt.md §8
├─ docs/architecture/c4/         # C4 PlantUML to-be (NC, dual front, Keycloak)
├─ tools/plantuml/               # Local plantuml.jar (gitignore) + README
├─ packages/notification-center/ # NC UI-пакет (шина, dock) — to-be → отдельный сервис/MFE
├─ db/Scinverse.Db.Migrator/     # DbUp (SQL-first, V001…V027+)
└─ services/online-history-server/
   ├─ src/                       # backend (.NET 8)
   │  ├─ Scinverse.Ohs.Domain            # домен (InstrumentKey, schedule, link_liveness, …)
   │  ├─ Scinverse.Ohs.Contracts         # DTO + IOhsApi
   │  ├─ Scinverse.Ohs.Ingestion         # нормализация/батчинг
   │  ├─ Scinverse.Ohs.Storage.Timescale # Npgsql COPY / Dapper
   │  ├─ Scinverse.Ohs.Connectors.Transaq# TRANSAQ, SyntheticLive
   │  └─ Scinverse.Ohs.Host              # Minimal API + /ws + NotificationHub (mock NC)
   ├─ tests/
   └─ web/                       # admin frontend (монолит; to-be — Admin Front)
      └─ src/{core,ui}
```

## 3. Индекс документации

**Обзор и концепция**
- [`docs/concept.md`](./concept.md) — принятые архитектурные решения (почему web-only UI, что берём из legacy).
- [`docs/ohs.md`](./ohs.md) — назначение и модель OHS (коннектор → нормализация → хранилище → API).
- [`docs/gant.md`](./gant.md) — концепт быстрого Ганта (real-time progress bar, WebGL2 + LOD/Timescale
  CA); почему не DOM/canvas, выбор фреймворка, подводный камень zoom ⟂ проекция (реализация — phase 12).
- [`README.md`](../README.md) — обзор монорепо.

**Архитектура (to-be)**
- [`docs/architecture/c4/arch.md`](./architecture/c4/arch.md) — **читать:** C4 to-be (NC, dual front MFE,
  Keycloak, OHS control-plane). Превью PlantUML: Local jar `tools/plantuml` (см. README там).
- [`docs/architecture/db-design.md`](./architecture/db-design.md) — модель данных (Р1–Р5).
- [`docs/architecture/ui-charting.md`](./architecture/ui-charting.md) — product-чартинг (не админка).

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
| 7i | «Управление записью»: полуавтомат Auto + Supervisor (MOEX) | IN PROGRESS | [phase7i/apply](./dev/phase7i/apply.md) |
| **7j** | Расписание соединения + инциденты связи v2 + **backend-outage v2** + system-NC JSON | **7j.17–7j.20 КОД ГОТОВ**; остаток 7j.15/7j.16 | [plan](./dev/phase7j/plan.md) · [report](./dev/phase7j/report.md) · [nc-availability](./dev/phase7j/nc-availability.md) · [incident](./dev/phase7j/incident.md) |
| 8 | CI/CD | TODO | — |
| 9 | Импорт QScalp `.qsh` | TODO | — |
| 10 | Keycloak + `user_settings` | PLANNED · **обязателен на gate 11→12** | [phase10](./dev/phase10/plan.md) |
| 11 | NC (пакет в монолите; путь к отдельному сервису) | IN PROGRESS | [phase11](./dev/phase11/plan.md) |
| **11→12** | **Gate:** вынос Admin Front + NC (MFE, Keycloak) по to-be C4 | FUTURE | [dev/plan.md](./dev/plan.md) §gate · [arch](./architecture/c4/arch.md) |
| 12 | Гант WebGL2 + LOD — **только после gate** | FUTURE | [phase12](./dev/phase12/plan.md) |

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

- **БД:** TimescaleDB из `docker-compose`, миграции DbUp (**до V027**).
- **Backend:** VS или `dotnet run` (`Scinverse.Ohs.Host`); секреты — `appsettings.Local.json`.
- **Frontend:** `services/online-history-server/web` → `pnpm install`, `pnpm dev --port 5174`
  (прокси `/api` + `/ws`). Тесты: `pnpm exec vitest run`, `pnpm exec tsc --noEmit`.
- **NC package:** `packages/notification-center` → `pnpm exec vitest run` (шина).
- **Backend-тесты:** `dotnet test` (integration/api — Docker/Testcontainers).
- **PlantUML:** `tools/plantuml/README.md` (Local jar) + Reload Window в VS Code.

## 6. Конвенции

- **Docs-as-code:** каждая фаза — `plan/apply/report.md`; решения по данным — в `db-design.md`.
- **Именование** — по Visual Studio/ReSharper; C# 12 (primary constructors), `LangVersion=12`.
- **Коммиты:** формат `feat(ohs-<phase>): …`; коммитит пользователь, ассистент готовит message.
- **SQL-first:** миграции DbUp (`V00N__*.sql`), чтение — Dapper, массовая запись — Npgsql COPY.
- **Frontend:** `core/` — без React (RxJS `BehaviorSubject`-стор + API/WS), `ui/` — тонкий React-слой
  (хуки `useObservable`/`useBehavior`). Тёмная тема (вдохновлено `scrider-editor`).

 ### Соглашения проекта (ВАЖНО)

- **Shell = PowerShell.** НЕ использовать `&&` (не разделитель!) и bash-heredoc (`$(cat <<EOF)`).
  Команды разделять `;`, коммит-сообщение — во временный файл + `git commit -F "$env:TEMP\msg.txt"`.
- **Lint зелёный обязателен**: `npx tsc --noEmit` (0) и `npx eslint src` (0 **errors**; ~14
  pre-existing `react-refresh` warnings допустимы — не роняют). Бэк: `dotnet build …Host.csproj`.
- **Commit style**: `feat(ohs-7j): …` (см. `git log`). Коммитить **только по явной просьбе** пользователя.
- LF→CRLF warnings от git на Windows — норма, игнорировать.
- Пользователь сам финализирует часть фронтового UI и сам решает, когда пушить.


## 7. Текущий момент

**OHS MVP (монолит Host + admin web + локальная шина NC)** в этом репо — активная разработка.
Гант/связь/расписание/инциденты 7j.17–7j.20 — **код готов**, часть сценариев принята на Finam id=3.

**To-be архитектура** зафиксирована в C4: отдельный **NC**, **Admin Front** и **Product Front** (MFE),
**Keycloak** везде. До WebGL (phase 12) — **gate 11→12**: вынос Admin Front + NC.

Карта фазы 7 — [phase7/roadmap.md](./dev/phase7/roadmap.md). Дорожная карта — [dev/plan.md](./dev/plan.md).

---

## 8. ➡️ НОВЫЙ ЧАТ — точка входа (2026-07-26)

### Прочитай первым (порядок)

1. Этот файл (§1–§6, §8).
2. [architecture/c4/arch.md](./architecture/c4/arch.md) — to-be (NC, dual front, Keycloak, gate).
3. [dev/plan.md](./dev/plan.md) — таблица фаз + **gate 11→12**.
4. [phase7j/report.md](./dev/phase7j/report.md) — живой статус 7j.
5. По задаче: [nc-availability.md](./dev/phase7j/nc-availability.md) (простой бэка) ·
   [incident.md](./dev/phase7j/incident.md) (связь) · [todo.md](./dev/phase7j/todo.md) (UI backlog).

### Где мы сейчас

| Контур | Состояние |
|--------|-----------|
| **OHS Host** | Write + control-plane + NotificationHub (mock NC). Миграции до **V027**. |
| **Admin web** | В монолите (`services/online-history-server/web`). |
| **NC** | Пакет `packages/notification-center` + события с Host; отдельный сервис — to-be. |
| **7j.20** | Связь v2 (J1–J8), backend-outage v2 (§9), system expanded = JSON. Коммиты `8bdfc6c`, `fd3e93e`. |
| **Архитектура** | C4 to-be зарисована; коммит `8b6825e`. |

### Инварианты NC (не ломать)

- **System** → короткий message + JSON (`result` / `error_message` + `sender`).
- **User** (расписание) → `data.lines[]` оставляем.
- Backend-outage: **не FATAL→OK**; всегда через WARNING; один corr на инцидент; progress-тики не персистить;
  лента newest-first по `ts`.
- `connect_failed` — ERROR в журнале, **не** hub-инцидент (констатация внешнего TRANSAQ).
- Фильтр «Активные» = поле `status` строки, не «инцидент ещё открыт».

### Ключевые файлы (код)

**Backend:** `ConnectionManager.cs`, `ConnectionSupervisor.cs`, `ClientRecoveryGate.cs`,
`GlobalExceptionHandler.cs`, `NotificationHub.cs`, `OhsEndpoints.cs`.

**Frontend:** `web/src/core/OhsStore.ts`, `notifications.ts`, `api.ts`, `live.ts`.

**NC package:** `packages/notification-center` (шина, dock, `detailText`: lines → иначе JSON).

### Очередь (что можно делать дальше)

1. **7j.15 / 7j.16** — market profile / `date`-авторинг ([todo.md](./dev/phase7j/todo.md)).
2. **UI NC** — счётчик, full-area, corr-фильтр не сбрасывает остальные фильтры.
3. **7i** — Auto записи (не смешивать connect в RecordingSupervisor).
4. **H1/H2 (7h)** — recording-ribbon бинарный под Degraded.
5. **Не начинать phase 12 WebGL** до gate 11→12 (вынос Admin Front + NC + Keycloak).

### Запуск

```text
БД:   docker-compose + DbUp (до V027)
Host: Scinverse.Ohs.Host (VS / dotnet run), appsettings.Local.json
Web:  services/online-history-server/web → pnpm dev --port 5174
PlantUML: tools/plantuml/plantuml.jar (см. tools/plantuml/README.md) + Reload Window
Тесты: dotnet test; pnpm exec vitest run; pnpm exec tsc --noEmit
```

### Соглашения (повтор)

- PowerShell: `;` не `&&`; коммит только по просьбе пользователя.
- Lint: tsc 0, eslint 0 errors; `dotnet build` Host.
- Commit style: `feat(7j.20): …` / `docs(arch): …`.

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
