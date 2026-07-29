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
| **7j** | Расписание + инциденты v2 + abandon | **инциденты ГОТОВЫ**; очередь 7j.15/16 · **I12 OPEN** | [report](./dev/phase7j/report.md) · [todo](./dev/phase7j/todo.md) · [I12](./dev/phase7j/issue.md#i12-после-recover-пул-npgsql-exhausted--пачка-ohsunhandled-500-orphan-active-fatal) |
| 8 | CI/CD | TODO | — |
| 9 | Импорт QScalp `.qsh` | TODO | — |
| 10 | Keycloak + `user_settings` | PLANNED · **обязателен на gate 11→12** | [phase10](./dev/phase10/plan.md) |
| **11** | **NC:** лента DONE; **11.13 журнал `incident` в OHS DONE** | gate 11→12 / хвосты | [incident-journal](./dev/phase11/incident-journal.md) · [plan](./dev/phase11/plan.md) · [to-threads](./dev/phase11/to-threads.md) |
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

- **7j инциденты** (связь break/crash, abandon, CloseBreak/Adopt, Auto×5 operator Singles) —
  **код готов**; очередь: 7j.15/16; хвост **I12 OPEN** (пул Npgsql / orphan FATAL после recover —
  RxJS sync coverage). См. [todo](./dev/phase7j/todo.md) · [issue I12](./dev/phase7j/issue.md).
- **phase 11 лента Thread** (11.1–11.12, ★/⊘, dock settings, тесты 11.7) — **DONE**.
- **11.13 журнал `incident` в OHS — DONE (a–f); H1 + J8 crash journal — DONE.** Дальше: gate **11→12** / I12 / full backfill.

**To-be:** `notification`/пакет → отдельный NC (MFE, своя БД) на **gate 11→12**;
`link_liveness` + `incident` остаются в OHS. Admin/Product + Keycloak — C4.

---

## 8. ➡️ НОВЫЙ ЧАТ — phase 11.13 журнал инцидентов (2026-07-29)

### Задача чата

**DESIGN AGREED** — канон [incident-journal.md](./dev/phase11/incident-journal.md).
**11.13 DONE.** Дальше — gate 11→12 / хвосты (не этот §12 checklist).

- **OHS DB:** `link_liveness` + `incident` (ribbon + журнал эпизодов).
- **NC (to-be / gate 11→12):** поток `notification` (сейчас V025) + пакет → MFE/сервис;
  Front и OHS ходят в NC самостоятельно.
- Инциденты модульные (`module`); connection: `break` / `crash`.
- Ribbon: liveness + incidents ← **OHS**.
- Wiki: [`wiki-readme/incident.md`](./wiki-readme/incident.md).

Не смешивать с 7j.15/16, I12 и WebGL (12).

### Прочитай первым (порядок)

1. Этот файл (§1–§6, §8).
2. [`wiki-readme/incident.md`](./wiki-readme/incident.md) — **что такое инцидент**.
3. [phase11/incident-journal.md](./dev/phase11/incident-journal.md) — **стартовая спека 11.13** (дописать).
4. [phase11/plan.md](./dev/phase11/plan.md) · [report.md](./dev/phase11/report.md) — статус фазы.
5. [phase11/to-threads.md](./dev/phase11/to-threads.md) — модель Thread/Incident/Group + §6 (A сейчас / B′ → NC).
6. [phase11/persistence.md](./dev/phase11/persistence.md) — V025 атомы в OHS (as-is audit).
7. [architecture/c4/arch.md](./architecture/c4/arch.md) — NC отдельный деплой / failure domain.
8. Контекст OHS-продюсера (не ломать): [phase7j/incident.md](./dev/phase7j/incident.md).

### Где мы сейчас

| Контур | Состояние |
|--------|-----------|
| **OHS Host** | NotificationHub + PersistWriter → V025. CloseBreak / Adopt / Forget. Auto×5 → Append `connect_failed` **status=active** + Single `connection.auto_stopped`; `GET /connections/needs-operator`. |
| **Admin web** | Монолит `web`; Vite → `:5080`. После `backend.recovered` → needs-operator → Single `connection.operator_action_needed`. |
| **NC package** | Thread `items$`, dock, ★/⊘ — **DONE**. Сорт: при равном ts Single над **open** Thread; **resolved** Thread над Single. |
| **phase11** | 11.1–11.12 + 11.7 **DONE**; **11.13 журнал DONE** (a–f). |
| **7j** | Инциденты код готов; **I12 OPEN** (не блокер журнала); очередь 7j.15/16. |

### Модель (кратко)

```text
OHS DB:     link_liveness + incident
NC (to-be): notification atoms + MFE UI (пакет @scinverse/notification-center)
OHS → NC:   publish notify (as-is Hub/V025 mock)
Admin:      ribbon/журнал←OHS · док ленты←NC (MFE)
```

- Group / вне горизонта → лента NC, не таблица `incident`.

### План работ (порядок) — [incident-journal §12](./dev/phase11/incident-journal.md)

1. **11.13a** миграция OHS `incident` + store  
2. **11.13b** JournalRegistrator (open/handover/close/Adopt → `incident`)  
3. **11.13c** GET `/api/incidents`  
4. **11.13d** UI журнала · **11.13e** ribbon←`incident`  
5. **11.13f** resolve / backfill  
(Вынос NC/V025 — gate 11→12, не этот список.)

### Инварианты (не ломать)

- Лента Thread v1 и wire атомов WS/REST / V025 hydrate.
- Incident vs Group: вид на Open по горизонту; Group **не** продолжает Incident (новый corr).
- System → короткий message + JSON (`result` / `error_message` + `sender`); user schedule → `lines[]`.
- ★/⊘ — клиент v1; не колонки журнала в первой итерации.
- **I10:** после **рестарта процесса** Host — Adopt open break из V025 → connect в `link:` (не Group `auto:`).
  `backend.recovered` на клиенте ≠ рестарт Host (сон ПК: fails×5 могут остаться в памяти).
- **Auto×5:** Incident остаётся open; Single WARN `connection.auto_stopped` (не в `link:`);
  финальный `connect_failed` — `status=active` (badge ACTIVE, не RECOVERING).
- Не тащить в этот чат WebGL, 7j.15/16, **I12** (отдельный хвост), полный Keycloak.
- **`phase7h/incident.md` — SUPERSEDED** как канон «инцидент» (дыры `capture_liveness` / подложка).
  Канон: wiki + 7j + этот журнал. Геометрию Connection-ганта здесь не трогать;
  связка **журнал ↔ гант** — после 11.13.

### Вне scope этого чата (уже зафиксировано / другой хвост)

| Тема | Где |
|------|-----|
| I12 pool exhausted + orphan ACTIVE 500; RxJS sync coverage | [phase7j/issue.md I12](./dev/phase7j/issue.md) |
| Auto×5 operator Singles + sort WARN/Incident | коммит `4d921c4`; `ConnectionSupervisor`, `projectThreads` |

### Ключевые файлы

**Спека журнала:** `docs/dev/phase11/incident-journal.md`  
**Модель Thread:** `docs/dev/phase11/to-threads.md`  
**Wiki:** `docs/wiki-readme/incident.md`  
**C4:** `docs/architecture/c4/arch.md`  
**As-is атомы:** Host `NotificationHub.cs`, `NotificationPersistWriter.cs`, V025  
**OHS-продюсер:** `ConnectionManager.cs`, `ConnectionSupervisor.cs`

### Запуск (справочно, для проверки ленты — не блокер дизайна)

```text
БД:   docker-compose + DbUp
Host: Scinverse.Ohs.Host → :5080
Web:  services/online-history-server/web → pnpm dev --port 5174
NC:   packages/notification-center → pnpm exec vitest run
```

### Соглашения

- PowerShell: `;` не `&&`; коммит только по просьбе пользователя.
- Lint: tsc 0, eslint 0 errors; `dotnet build` Host.
- Commit style: `feat(11): …` / `feat(nc): …` / `docs(11): …`.

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
