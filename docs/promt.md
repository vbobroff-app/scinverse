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
├─ docs/promt.md                 # вход нового чата / handoff (этот файл, §8)
├─ docs/wiki-readme/             # продукт: incident.md, layers.md, write-gaps.md
├─ docs/dev/phase11/             # NC + journal; soft-delete → incident-soft-delete.md
├─ docs/dev/phase11/schedule-projection.md  # канон: факты ⊥ mask/Cutter
├─ docs/dev/phase7h/write-gaps.md           # Writers Gantt: WriteHole/WriteGap (спека)
├─ docs/architecture/c4/         # C4 PlantUML to-be (NC, dual front, Keycloak)
├─ docs/architecture/ohs-connectors-deploy.md  # TRANSAQ Windows-агент / finam-ws to-be
├─ tools/plantuml/               # Local plantuml.jar (gitignore) + README
├─ packages/notification-center/ # NC UI-пакет (шина, dock) — to-be → отдельный сервис/MFE
├─ db/Scinverse.Db.Migrator/     # DbUp (SQL-first, V001…V030+)
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
| **11** | NC Thread + journal + soft-delete + crash | **11.13a–g DONE**; soft-delete V030 | [soft-delete](./dev/phase11/incident-soft-delete.md) · [report](./dev/phase11/report.md) · [journal](./dev/phase11/incident-journal.md) |
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

- **БД:** TimescaleDB из `docker-compose`, затем миграции DbUp (**актуально V030** · soft-delete):

  ```powershell
  dotnet run --project db/Scinverse.Db.Migrator
  ```

  Connection: CLI-аргумент → env `SCINVERSE_DB` → default
  `Host=localhost;Port=5432;Database=scinverse;Username=scinverse;Password=scinverse`.
  Без новых `V0xx` код может давать **HTTP 500** (пример: без V030 — `/api/incidents` на `deleted_at`).
  Подробнее — §8.3.

- **Backend:** VS или `dotnet run` (`Scinverse.Ohs.Host`); секреты — `appsettings.Local.json`.
  Перед `dotnet build`/`dotnet test` Host — **остановить** (lock DLL на Windows).
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
| Soft-delete journal (V030 / 11.13g / I14) | **DONE** (`738b384`…`7b3c75d`) |
| Schedule-as-projection P1–P5.5 | **DONE** (Cutter writers P1.2 — deferred) |

**Коммиты wrap-up:** `6c7c36c` · `255cc93`. **I12 клиент:** `6871a57` · `327c8fe`.  
**Soft-delete:** `738b384`…`cc634c2` + audit label `7b3c75d`.  
Host при `dotnet test` не должен держать DLL (остановить VS/Host).

**Handoff нового чата:** §8 ниже.  
**Later:** gate **11→12** (NC MFE + Keycloak); hard-delete / retention; deploy —
[ohs-connectors-deploy.md](./architecture/ohs-connectors-deploy.md).

---

## 8. ➡️ НОВЫЙ ЧАТ — soft-delete DONE + контекст (2026-08-02)

Единственный handoff-файл — **этот** (`docs/promt.md`). Спеки фазы — в `docs/dev/phase11/`.

**Отвечать по-русски**, если пользователь пишет по-русски.  
Коммит — **только по явной просьбе**.

### 8.1. Baseline

| Тема | Статус |
|------|--------|
| NC Thread 11.8–11.12 | DONE |
| Journal 11.13a–f + I2 fan-out | DONE |
| Crash dispatch D1–D8 + P5 2NF + I13 adopt-from-journal | DONE |
| Schedule projection P1–P4 (+ Cutter writers deferred) | DONE / partial |
| **Soft-delete journal (11.13g / I14)** | **DONE** |
| Gate 11→12 (NC MFE), WebGL 12, hard-delete retention | later |
| 7j I12 Host pool size | defer @100 |

### Soft-delete — суть

Ось **видимости** ⊥ lifecycle: `incident.deleted_at` / `deleted_by` (**V030**).  
Не `status=deleted`. Delete open = `abandoned_manual` (+ Halt/Auto-off при recovering) → tombstone.
Restore снимает tombstone. Ribbon **всегда** без deleted; журнал — галка + `includeDeleted`;
ЦУ — Выбор «Удалённые» (`softDeletedCorrs$` + badge deleted). Атомы hub/V025 **не** удаляются.
Audit NC: `Журнал инцидентов {id} («{name}»): Запись удалена/восстановлена оператором`
(не `ScheduleWho` / «Расписание»). Hard delete / retention — вне scope.

Канон: [`incident-soft-delete.md`](./dev/phase11/incident-soft-delete.md).

### 8.2. Прочитай первым

1. Этот файл (§1–§7 + этот §8).
2. Спека: [`incident-soft-delete.md`](./dev/phase11/incident-soft-delete.md).
3. Journal: [`incident-journal.md`](./dev/phase11/incident-journal.md) (§6, §8, §12 **11.13g**).
4. NC Выбор: [`nc-marks.md`](./dev/phase11/nc-marks.md) (`deleted`).
5. Статус: [`report.md`](./dev/phase11/report.md) · [`plan.md`](./dev/phase11/plan.md).
6. Issues: [`issue.md`](./dev/phase11/issue.md) **I14** (I2/I13 при fan-out/adopt).
7. Расписание / mask: [`schedule-projection.md`](./dev/phase11/schedule-projection.md).
8. Wrap-up: [`incident-model-wrapup.md`](./dev/incident-model-wrapup.md).

### 8.3. Миграции (DbUp)

SQL-first: `db/migrations/V00N__….sql`. Раннер: `db/Scinverse.Db.Migrator`.

```powershell
dotnet run --project db/Scinverse.Db.Migrator
# опц.: -- "Host=…;Port=5432;Database=scinverse;Username=…;Password=…"
# или env SCINVERSE_DB
```

Default CS: `Host=localhost;Port=5432;Database=scinverse;Username=scinverse;Password=scinverse`.  
Успех: `Миграции применены успешно.` Уже применённые DbUp пропускает.

**Когда обязательно:** после pull с новым `V0xx` — до/сразу после рестарта Host, иначе 500.  
Soft-delete DDL: `db/migrations/V030__incident_soft_delete.sql`.

Типичный цикл:

```text
1. docker-compose up (Timescale)
2. dotnet run --project db/Scinverse.Db.Migrator
3. Host → :5080
4. Web → pnpm dev --port 5174 --force
```

### 8.4. API / якоря (soft-delete)

```text
GET  /api/incidents?includeDeleted=          # default false
GET  /api/connections/{id}/incidents         # всегда без deleted
POST /api/incidents/{corr}/delete            # { deletedBy? }
POST /api/incidents/{corr}/restore
POST /api/incidents/{corr}/resolve           # 409 если soft-deleted
WS   incidentVisibilityChanged               # { corrUid, deleted, connectionId? }
```

| Слой | Путь |
|------|------|
| DDL | `db/migrations/V030__incident_soft_delete.sql` |
| Store / API | `IncidentStore`, `OhsEndpoints` delete/restore |
| Live | `IncidentVisibilityChangedEvent` |
| Web | `ConnectionIncidentsModal`, `IncidentsSection`, `incidentsJournalStorage` |
| NC | `softDeletedCorrs$`, `filterItems` (`deleted`), `ThreadBlock` badge |

localStorage: `ohs:incidentsJournal:showDeleted` · `ohs:notificationDock` (choices, в т.ч. `deleted`).

### 8.5. Инварианты (не ломать)

- Soft-delete = видимость; lifecycle `active|recovering|resolved`.
- Journal SoT эпизодов; NC — уведомления (атомы можно не удалять).
- Ribbon / by-connection incidents — без soft-deleted.
- Delete open ≡ manual close, затем tombstone; resolve soft-deleted → 409.
- Adopt open break — из **`incident`**, не из `notification` (I13).
- Ribbon refresh — только `OhsStore` pipeline (I12).
- **I10:** stale-close open break **только** при `Live`.
- TRANSAQ `request_timeout=10`; Host `Max Pool Size=100` — не поднимать без боли.
- Не воскрешать `:h` clip.

### 8.6. Запуск / проверки

```powershell
dotnet run --project db/Scinverse.Db.Migrator
dotnet test services/online-history-server/tests/Scinverse.Ohs.UnitTests/Scinverse.Ohs.UnitTests.csproj
cd packages/notification-center; pnpm exec vitest run
cd services/online-history-server/web; pnpm exec tsc --noEmit; pnpm exec vitest run
```

PowerShell: `;` не `&&`. Commit-msg → UTF-8 без BOM + `git commit -F`.  
Стиль: `feat(ohs-11): …` / `feat(ohs-web): …` / `feat(nc): …` / `docs(11): …`.

### 8.7. Возможные следующие задачи

- Hard delete / retention purge soft-deleted (+ опц. старые resolved).
- Gate 11→12: NC-сервис / MFE + Keycloak.
- P1.2 ScheduleCutter writers (если ещё deferred).
- 7j.15/16 UI tails; Host pool I12 step 3.
- ~~Startup-latency справочника (~3 мин)~~ — **DONE** (Finam ~10–16 с;
  [startup-latency.md](./dev/phase7h/startup-latency.md) · 7j H3).
- **Write Gaps (Writers / 7h):** спека [write-gaps.md](./dev/phase7h/write-gaps.md) ·
  продукт [wiki write-gaps](./wiki-readme/write-gaps.md); код — после/вместе с P1.2 Cutter.

Уточнять у пользователя scope — не начинать gate/WebGL «заодно».

### 8.8. Архив: schedule-as-projection (DONE)

Идеология: факты ⊥ schedule-as-mask/Cutter — [`schedule-projection.md`](./dev/phase11/schedule-projection.md).  
P1–P4 + P5.0–P5.5 (2NF crash, I13) — **DONE**; `:h` отклонён; Group-by-desired / Auto
`abandoned_schedule` сняты (P4). План шагов —
[`plan-schedule-projection.md`](./dev/phase11/plan-schedule-projection.md).

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
