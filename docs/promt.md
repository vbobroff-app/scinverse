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
├─ docs/wiki-readme/             # продукт: incident.md, layers.md
├─ docs/dev/phase11/schedule-projection.md  # канон to-be: факты ⊥ mask/Cutter
├─ docs/architecture/c4/         # C4 PlantUML to-be (NC, dual front, Keycloak)
├─ docs/architecture/ohs-connectors-deploy.md  # TRANSAQ Windows-агент / finam-ws to-be
├─ tools/plantuml/               # Local plantuml.jar (gitignore) + README
├─ packages/notification-center/ # NC UI-пакет (шина, dock) — to-be → отдельный сервис/MFE
├─ db/Scinverse.Db.Migrator/     # DbUp (SQL-first, V001…V028+)
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
- [`docs/architecture/ohs-connectors-deploy.md`](./architecture/ohs-connectors-deploy.md) — TRANSAQ DLL =
  Windows-агент; Linux control-plane; следующий коннектор **finam-ws**; `request_timeout=10`.
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
| **7j** | Расписание + инциденты v2 | **I10/I11 ПРИНЯТО**; **I12 клиент DONE** (pool defer); очередь 7j.15/16 | [wrap-up](./dev/incident-model-wrapup.md) · [plan §7j.22](./dev/phase7j/plan.md) · [I12](./dev/phase7j/issue.md) |
| 8 | CI/CD | TODO | — |
| 9 | Импорт QScalp `.qsh` | TODO | — |
| 10 | Keycloak + `user_settings` | PLANNED · **обязателен на gate 11→12** | [phase10](./dev/phase10/plan.md) |
| **11** | NC Thread + journal + crash D1–D8 | DONE as-is; **next: schedule-projection** | [schedule-projection](./dev/phase11/schedule-projection.md) · [plan](./dev/phase11/plan-schedule-projection.md) · [crash as-is](./dev/phase11/crash-dispatch.md) |
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

- **БД:** TimescaleDB из `docker-compose`, миграции DbUp (**до V028**).
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

**OHS MVP** (монолит Host + admin web + пакет NC) — активная разработка.

**Инцидентная модель стабилизирована** (2026-07-31) — якорь:
[incident-model-wrapup.md](./dev/incident-model-wrapup.md).

| Контур | Статус |
|--------|--------|
| `incident` journal ⊥ NC (fan-out) | DONE · приёмка |
| `link_liveness` / ribbon от journal | DONE |
| Thread UI + crash dispatch Host (T/C) | DONE (phase 11) |
| Adopt crash-inside-break (stale-close **только Live**) | **ПРИНЯТО** |
| TRANSAQ `request_timeout=10` (~8 с Degraded на кабеле) | DONE |
| NC: при равном ts **ok выше warning** | DONE |
| CloseBreak sourceId из store; Resolve journal await | DONE (`255cc93`) |
| **I12 / 7j.22** pool exhausted → пачка FATAL | **КЛИЕНТ DONE** (`6871a57` · `327c8fe`); pool defer @100 |

**Коммиты wrap-up:** `6c7c36c` · `255cc93`. **I12 клиент:** `6871a57` (ribbon pipeline) ·
`327c8fe` (close-all orphan health-ok).  
Unit: **186/186**. Host при `dotnet test` не должен держать DLL (остановить VS/Host).

**Следующий фокус:** schedule-as-projection — §8 ниже.  
**Later:** gate **11→12** (NC MFE + Keycloak); deploy —
[ohs-connectors-deploy.md](./architecture/ohs-connectors-deploy.md) (Windows-агент DLL, finam-ws later).

---

## 8. ➡️ НОВЫЙ ЧАТ — schedule-as-projection (2026-07-31)

### Задача чата

Реализовать переход на идеологию **«факты независимо от расписания; schedule = маска / Cutter»**
по плану [`dev/phase11/plan-schedule-projection.md`](./dev/phase11/plan-schedule-projection.md).
`:h` clip в journal — **отклонён** (кода нет). Group-by-desired / `abandoned_schedule` на Auto — **P4 DONE**.

### Где мы (baseline → после чата)

| Тема | Статус |
|------|--------|
| Incident journal + NC fan-out, crash D1–D8 | DONE |
| I12 ribbon pool / orphan FATAL | клиент DONE; pool **DEFER** @100 |
| Adopt Live-only / CloseBreak race / NC crash header | DONE |
| P1 ScheduleCutter (+ unit); P1.2 writers | P1.1 DONE; P1.2 deferred |
| P2 UI void mask | DONE |
| P3 always-Incident | DONE |
| P4 remove Group outage + abandon | DONE |
| P5 2NF crash journal | P5.0 design DONE (docs); код later · cutover=purge NC |
| Gate 11→12, WebGL 12, 7j.15/16 | later, не смешивать |

### Прочитай первым (порядок)

1. Этот файл (§1–§7 + этот §8).
2. **Канон to-be:** [`schedule-projection.md`](./dev/phase11/schedule-projection.md).
3. **План шагов P0→P5:** [`plan-schedule-projection.md`](./dev/phase11/plan-schedule-projection.md).
4. Wiki: [`incident.md`](./wiki-readme/incident.md) · [`layers.md`](./wiki-readme/layers.md).
5. As-is (не ломать вслепую): [`incident-journal.md`](./dev/phase11/incident-journal.md) §2,
   [`crash-dispatch.md`](./dev/phase11/crash-dispatch.md) (помечен as-is / `:h` rejected).
6. Инварианты wrap-up: [`incident-model-wrapup.md`](./dev/incident-model-wrapup.md).

### Идеология в одном абзаце

Регистрируем каждый data-affecting failure (crash / break / релевантный 500) **честно**, полный span,
**всегда Incident** в NC + journal. Расписание не решает «инцидент или Group». UI — **void mask**
(~0.8 чёрный) вне desired на Connection-треке (⊥ SessionFilter). Writers — **ScheduleCutter**
(`gaps ∩ desired`, type-agnostic). Supervisor Auto connect/disconnect остаётся;
`abandoned_schedule` и Group-outage на Auto stop **сняты** (P4; live API удалены).
`abandoned_manual` + UI resolve **обязательны** (иначе active висят вечно).
2NF crash (P5): design в `plan-schedule-projection.md` §P5; история NC — purge, не dual-read.

### Порядок работ (деликатно)

```text
P1–P4                             ← DONE (Cutter P1.2 writers ещё deferred)
P5.0 docs 2NF decisions           ← DONE
P5.1–P5.4 incident_connection     ← следующий код (спросить перед стартом)
```

**Не** воскрешать `:h`. Перед P5.1 — спросить; cutover NC = purge + Host restart (Hub in-memory).

### Инварианты (не ломать)

- Journal ⊥ NC; ribbon/`incident` не зависят от выноса NC.
- **I10:** stale-close open break **только** при `Live`.
- CloseBreak: WS resolve до journal; journal resolve **await** — `255cc93`.
- Ribbon refresh — только через `OhsStore` pipeline (I12).
- TRANSAQ: `request_timeout=10`; не QuickPath / NetworkChange / вторая DLL.
- Host `Max Pool Size=100` — не поднимать без новой боли exhausted.

### Запуск

```text
БД:   docker-compose + DbUp
Host: Scinverse.Ohs.Host → :5080   (остановить перед dotnet build/test — lock DLL)
Web:  services/online-history-server/web → pnpm dev --port 5174
NC:   packages/notification-center → pnpm exec vitest run
Unit: dotnet test …/Scinverse.Ohs.UnitTests.csproj
```

### Соглашения

- PowerShell: `;` не `&&`; коммит-msg → файл UTF-8 **без BOM** + `git commit -F`.
- Коммит **только по явной просьбе** пользователя.
- Lint: tsc 0, eslint 0 errors; `dotnet build` Host.
- Commit style: `feat(ohs): …` / `feat(ohs-web): …` / `feat(ohs-11): …` / `docs(11): …`.
- Отвечать по-русски, если пользователь пишет по-русски.

### Критерий «готово» для чата

Acceptance §9: P1–P4 на стенде; P5 (2NF) не обязателен в первом проходе.

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
