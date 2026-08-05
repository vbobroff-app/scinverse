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
├─ docs/wiki-readme/             # пользовательская wiki (catalog / layers / write-gaps / …)
├─ docs/dev/plan.md              # Stages 0–4 + Future Features
├─ docs/dev/stage1/abandoned.md  # хвосты Stage 1 вне MVP (OPT сняты)
├─ docs/dev/baskets-observed.md  # DRAFT: Available / Observed / baskets (не код)
├─ docs/dev/phase8/              # OHS journal + schedule-projection + crash (Stage 1)
├─ docs/dev/phase7h/write-gaps.md # Writers Gantt WriteHole/WriteGap (DONE)
├─ docs/dev/phase7i/issue.md     # 7i.OPT FORTS ATM — DONE
├─ docs/dev/phase11/             # NC + split (Stage 2); to-threads = канон Thread subtypes
├─ docs/architecture/c4/         # C4 PlantUML to-be (NC, dual front, Keycloak)
├─ docs/architecture/ohs-connectors-deploy.md  # TRANSAQ Windows-агент / finam-ws to-be
├─ tools/plantuml/               # Local plantuml.jar (gitignore) + README
├─ packages/notification-center/ # NC UI-пакет (шина, dock) — to-be → отдельный сервис/MFE
├─ db/Scinverse.Db.Migrator/     # DbUp (SQL-first, V001…V030+)
└─ services/online-history-server/
   ├─ src/                       # backend (.NET 8)
   │  ├─ Scinverse.Ohs.Domain            # домен (+ ScheduleCutter, schedule, link_liveness, …)
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
- [`docs/architecture/db-design.md`](./architecture/db-design.md) — модель данных (Р1–Р5) + Online lifecycle / OPT.
- [`docs/architecture/ui-charting.md`](./architecture/ui-charting.md) — product-чартинг (не админка).

**Wiki (оператор / продукт)**
- [`docs/wiki-readme/catalog.md`](./wiki-readme/catalog.md) — Online-каталог, ATM, Refresh, архив vs intraday.
- [`docs/wiki-readme/layers.md`](./wiki-readme/layers.md) · [`write-gaps.md`](./wiki-readme/write-gaps.md) ·
  [`incident.md`](./wiki-readme/incident.md).

**Код (обзор реализованного)**
- [`docs/solution/code.md`](./solution/code.md) — что реализовано по проектам (backend + frontend),
  схема БД (миграции), тесты. **Живой документ — держим в актуальном состоянии.**

**План разработки (Stages → фазы)**
- [`docs/dev/plan.md`](./dev/plan.md) — дорожная карта: **Stage 0–4** + Future Features (QScalp/Plaza2).
- [`docs/dev/stage1/abandoned.md`](./dev/stage1/abandoned.md) — хвосты Stage 1 **вне MVP** (production backlog).
- [`docs/dev/baskets-observed.md`](./dev/baskets-observed.md) — **DRAFT** baskets / Observed (следующий горизонт каталога).
- [`docs/dev/apply.md`](./dev/apply.md) — дизайн Stage 1 (управление записью + панель покрытия).
- [`docs/dev/phase7/roadmap.md`](./dev/phase7/roadmap.md) — карта семейства фаз 7 (MVP админки).
- [`docs/dev/phase7/mvp-to-release.md`](./dev/phase7/mvp-to-release.md) — швы MVP→release.
- [`docs/tickers-options.md`](./tickers-options.md) — протокол OPT Finam / TRANSAQ.
- Каждая фаза — `docs/dev/phaseN/{plan,apply,report}.md`.

**Stages (кратко)**

| Stage | Тема | Фазы | Статус |
| ----- | ---- | ---- | ------ |
| 0 | Data foundation | 0–3 | DONE |
| **1** | OHS + admin MVP (запись, Гант, журнал) | **4–8** | **DONE** |
| 2 | Keycloak + NC/split сервисов | 10–11 | PLANNED |
| 3 | WebGL Гант | 12 | FUTURE |
| 4 | Кэш + CI/CD на стенды | 13–14 | PLANNED |

**Статус фаз Stage 1 (закрыт 2026-08-04)**

| Фаза | Тема | Статус | Ссылка |
| ---- | ---- | ------ | ------ |
| 0,1,3 | Data foundation | DONE | [phase0](./dev/phase0/report.md) |
| 4 | Локальный E2E TRANSAQ | DONE | [phase4](./dev/phase4/report.md) |
| 5 | Мультиисточник (`source_id`) | DONE | [phase5](./dev/phase5/report.md) |
| 6a–6c | Coverage + control-plane + derivative | DONE | [6a](./dev/phase6a/report.md) · [6b](./dev/phase6b/report.md) · [6c](./dev/phase6c/report.md) |
| 7 | Админ-фронт (ур.3 MVP; ур.1 WONT; общий Гант → после WebGL) | DONE | [phase7](./dev/phase7/report.md) |
| 7b–7g | Таймфреймы, ISS, фильтры, connect UI, ось, слой сделок | DONE / MVP DONE | roadmap |
| **7h** | Liveness + Connection-ribbon + **Write Gaps** (+ OPT ATM) | **DONE** | [report](./dev/phase7h/report.md) · [write-gaps](./dev/phase7h/write-gaps.md) |
| 7i | Auto / Supervisor + Integrations + **OPT/Refresh/lifecycle** | MVP DONE | [report](./dev/phase7i/report.md) · [7i.OPT](./dev/phase7i/issue.md) |
| 7j | Расписание соединения + инциденты v2 | MVP DONE | [report](./dev/phase7j/report.md) · [wrap-up](./dev/incident-model-wrapup.md) |
| **8** | **OHS journal, soft-delete, crash, void mask, schedule-projection** | **DONE** | [phase8/plan](./dev/phase8/plan.md) · [journal](./dev/phase8/incident-journal.md) |

Хвосты 7i/7j/… — [`stage1/abandoned.md`](./dev/stage1/abandoned.md)
(`7h.OPT`/`7i.OPT` **сняты**; intraday — **7c.9**/**7c.SEC**, не путать с DONE **7b.2**).

**Дальше (не Stage 1)**

| Фаза | Тема | Статус | Ссылка |
| ---- | ---- | ------ | ------ |
| 10 | Keycloak + `user_settings` | PLANNED · Stage 2 | [phase10](./dev/phase10/plan.md) |
| 11 | NC продукт + split OHS / Admin Front / NC | PLANNED · Stage 2 (база NC в монолите DONE) | [phase11](./dev/phase11/plan.md) |
| 12 | WebGL2 + LOD | FUTURE · Stage 3 (после gate 10+11) | [phase12](./dev/phase12/plan.md) |
| 13 | Сквозной кэш | PLANNED · Stage 4 | [phase13](./dev/phase13/plan.md) |
| 14 | CI/CD на стенд/prod | TODO · Stage 4 | [phase14](./dev/phase14/plan.md) |
| — | QScalp / Plaza2 | Future Features | [plan.md](./dev/plan.md) §Future |

## 4. Ключевые доменные факты (быстрый ввод)

- **Инструмент** — `(ticker, board)`; мультиисточник: PK фактов включает `source_id`
  (одна бумага может иметь сделки из разных провайдеров — цвет колбаски = источник).
- **Деривативы** — таблица `derivative` (FUT/OPT); навигация — **фильтры 7d** (дерево descoped),
  `groups` питает значения. Парсинг MOEX FORTS — `MoexFortsSpecParser`, серии — `MoexSeries`.
- **Online-каталог (DONE)** — две оси: **lifecycle** `instrument.active` (архив по `expiration`, МСК)
  ≠ **intraday** «торгуется сейчас» (долг **7c.9** борд / **7c.SEC** `sec_status`). Connect-dump
  часто без OPT → ATM ±N через `get_option_families` → `get_family_strikes` → `get_options`.
  Refresh: dump stale + lifecycle sweep + сброс OPT-окон; NC два Group (`action` / `lifecycle`).
  Wiki — [catalog](./wiki-readme/catalog.md); issue — [7i.OPT](./dev/phase7i/issue.md).
- **NC Thread subtypes (DONE в монолите)** — `Incident`→Crash|Break (`data.kind`→`incidentKind`);
  `Group`→Lifecycle|Action|Checkup (`data.groupKind`, default `action`). UI Group = ярлык подтипа.
  Канон — [phase11/to-threads.md](./dev/phase11/to-threads.md).
- **Расписание сессий** — `/api/sessions` через `IMarketCalendar` (ISS `timetable`/`dailytable`,
  fallback `MoexSchedule`). Курируемая история в `market_schedule` (7i); ось Ганта пока ещё на
  «текущем» ISS — хвост **7i.S1** в [abandoned](./dev/stage1/abandoned.md). Integrations:
  адаптер **scinverse** (Finam/ISS с приоритетом) — confirmer, не тот же контур что `/api/sessions`.
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
- **Честная подложка / разрывы** (phase 7h, **DONE**) — **Намерение** ∩ **Живость** (`capture_liveness`);
  дыра в живости = обрыв; дыра в сделках при живой подложке = тихий рынок. Вне сессии пинги не идут
  (`LivenessProbe`). Отчёт — [phase7h/report.md](./dev/phase7h/report.md).
- **Connection Gantt** (phase 8 / 7h.8) — лента `link_liveness` + инциденты из journal; сверху
  **schedule void mask** (`showScheduleMask$`, вне desired). Soft-delete скрывает с ribbon.
- **Writers Gantt — Write Gaps** (7h, **DONE**) — красный на инструменте =
  `WriteGap = ScheduleCutter(WriteHole ∩ desired)`; API `POST /api/coverage/write-gaps`;
  тумблер `showWriteGaps$`. Спека — [write-gaps.md](./dev/phase7h/write-gaps.md) ·
  wiki [write-gaps](./wiki-readme/write-gaps.md).
- **Журнал `incident`** (phase 8, бывш. 11.13) — SoT эпизодов в OHS; fan-out в NC atoms; soft-delete V030.
  Канон — [phase8/incident-journal.md](./dev/phase8/incident-journal.md).
- **Schedule-as-projection** — факты ⊥ mask/Cutter: [phase8/schedule-projection.md](./dev/phase8/schedule-projection.md).

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


## 7. Текущий момент (2026-08-05)

**Stage 1 = DONE** (2026-08-04). После close дожали Online-каталог и NC subtypes (см. §8.1).
Пакет NC в монолите готов; **вынос NC / Keycloak / WebGL — Stage 2–3**.

Хвосты вне MVP — [`dev/stage1/abandoned.md`](./dev/stage1/abandoned.md).  
План Stages — [`dev/plan.md`](./dev/plan.md).

| Контур | Статус |
|--------|--------|
| Stage 1 phase 4–8 | **DONE** |
| `incident` journal ⊥ NC · soft-delete V030 | DONE · docs **phase 8** |
| Connection-ribbon + schedule void mask | DONE |
| Writers Write Gaps (`ScheduleCutter`) | DONE |
| Online-каталог: OPT ATM ±N + Refresh + `instrument.active` | **DONE** · не Stage 2 |
| NC Thread subtypes Crash/Break + Lifecycle/Action/Checkup | **DONE** (монолит) · Stage 2 = split |
| Crash: flush LS pending на **первом** WS open | **DONE** (`60d3e11`) |
| Connection toggle при OHS outage | красный **error** + × (`92778c8`); Auto — yellow unreachable |
| Adopt / I10 / I12 клиент | ПРИНЯТО / DONE; pool defer @100 |
| Schedule-as-projection P1–P5 + P2 mask | **DONE** |
| Baskets / Observed | **DRAFT** спека · [baskets-observed](./dev/baskets-observed.md) |

Host при `dotnet test` / rebuild — **остановить** (lock DLL на Windows).  
**Handoff:** §8. Типичный next — уточнить у пользователя (baskets vs Stage 2 vs production backlog).

---

## 8. ➡️ НОВЫЙ ЧАТ — handoff (обновлено 2026-08-05)

Единственный handoff-файл — **этот** (`docs/promt.md`).

**Отвечать по-русски**, если пользователь пишет по-русски.  
Коммит — **только по явной просьбе**. PowerShell: `;` не `&&`; commit-msg → файл + `git commit -F`.

### 8.1. Baseline

| Тема | Статус | Docs / коммиты |
|------|--------|----------------|
| Stage 1 (phase 4–8) | **DONE** | [plan.md](./dev/plan.md) · [abandoned](./dev/stage1/abandoned.md) |
| Journal + soft-delete + crash T/C | DONE | [phase8/](./dev/phase8/plan.md) |
| Write Gaps + void mask | DONE | [write-gaps](./dev/phase7h/write-gaps.md) · [schedule-projection](./dev/phase8/schedule-projection.md) |
| **7h.OPT / 7i.OPT** + lifecycle + Refresh UX/NC | **DONE** | [catalog](./wiki-readme/catalog.md) · [7i.OPT](./dev/phase7i/issue.md) · `df64a12`…`803fa8d` |
| NC Group/Incident subtypes | **DONE** | [to-threads](./dev/phase11/to-threads.md) · `eb8f2cc` |
| Crash pending flush + Connection red mask | **DONE** | `60d3e11` · `92778c8` |
| Baskets / Observed | DRAFT only | [baskets-observed](./dev/baskets-observed.md) (**??** untracked) |
| Gate Stage 2 → WebGL | later | phase 10 + 11 |
| Production backlog | open | [abandoned](./dev/stage1/abandoned.md) — **без** OPT |

**Git (на момент handoff):** ветка `main` сильно ahead origin; **docs** (plan/abandoned/promt/catalog/
phase11 to-threads/…) часто **ещё не закоммичены** — сверить `git status`. Код OPT/NC/crash —
уже в истории выше.

### Soft-delete — суть (кратко)

Ось **видимости** ⊥ lifecycle: `deleted_at` / `deleted_by` (**V030**). Не `status=deleted`.
Ribbon всегда без deleted; journal — `includeDeleted`; NC — Выбор «Удалённые».
Канон: [`phase8/incident-soft-delete.md`](./dev/phase8/incident-soft-delete.md).

### 8.2. Прочитай первым

1. Этот файл (§1–§7 + этот §8).
2. Дорожная карта: [`dev/plan.md`](./dev/plan.md) (§ Stage 1 — абзац про каталог DONE).
3. Хвосты: [`stage1/abandoned.md`](./dev/stage1/abandoned.md) (таблица каталог + ids **7c.9/7c.SEC**, **7b.TIP**).
4. Каталог Online: [`wiki-readme/catalog.md`](./wiki-readme/catalog.md) · [`tickers-options.md`](./tickers-options.md) ·
   [`phase7i/issue.md`](./dev/phase7i/issue.md).
5. NC Threads: [`phase11/to-threads.md`](./dev/phase11/to-threads.md) · [plan](./dev/phase11/plan.md).
6. Journal / crash / mask: [`phase8/`](./dev/phase8/plan.md)
   ([journal](./dev/phase8/incident-journal.md) · [soft-delete](./dev/phase8/incident-soft-delete.md) ·
   [schedule-projection](./dev/phase8/schedule-projection.md) · [crash](./dev/phase8/crash-dispatch.md)).
7. Write Gaps: [`phase7h/write-gaps.md`](./dev/phase7h/write-gaps.md).
8. Wrap-up инцидентов: [`incident-model-wrapup.md`](./dev/incident-model-wrapup.md).
9. Если следующий шаг = working set: [`baskets-observed.md`](./dev/baskets-observed.md) (draft).

> Старые пути `phase11/incident-*.md` — **stubs** → `phase8/`. Канон journal только в phase8.

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

- Soft-delete = видимость; lifecycle инцидента `active|recovering|resolved`.
- Journal SoT эпизодов; NC — уведомления (атомы можно не удалять).
- Ribbon / by-connection incidents — без soft-deleted.
- Delete open ≡ manual close, затем tombstone; resolve soft-deleted → 409.
- Adopt open break — из **`incident`**, не из `notification` (I13).
- Ribbon refresh — только `OhsStore` pipeline (I12).
- **I10:** stale-close open break **только** при `Live`.
- TRANSAQ `request_timeout=10`; Host `Max Pool Size=100` — не поднимать без боли.
- Не воскрешать `:h` clip.
- **`instrument.active`** = архив по exp Online; ≠ intraday `sec_status` / борд.
- NC: `threadKind` = политика; `incidentKind`/`groupKind` = тематика; mid-flight reclass запрещён.
- Crash outage: `createLiveStream` — `onReconnect`/flush pending на **каждом** успешном open
  (не только со 2-го); `onDrop` — после первого успешного соединения.
- Catalog Refresh: кэш corr → `groupKind: action`; актуальность → `lifecycle`.

### 8.5b. Каталог — якоря API / код

```text
POST /api/instruments/catalog/refresh
GET  /api/connections/{id}/option-families
POST /api/connections/{id}/load-options
```

| Слой | Путь |
|------|------|
| OPT load | `OptionCatalogService`, `IOptionCatalogLoader` / Transaq |
| Lifecycle | `InstrumentLifecycleService`, `InstrumentStore` (`active`) |
| Refresh NC | `CatalogRefreshNc` |
| Web | expand FUT/series, `ProviderCard` Refresh + confirm |
| Depth | `Ohs:OptionAtmDepth` (default 15) |

### 8.6. Запуск / проверки

```powershell
dotnet run --project db/Scinverse.Db.Migrator
dotnet test services/online-history-server/tests/Scinverse.Ohs.UnitTests/Scinverse.Ohs.UnitTests.csproj
cd packages/notification-center; pnpm exec vitest run
cd services/online-history-server/web; pnpm exec tsc --noEmit; pnpm exec vitest run
```

PowerShell: `;` не `&&`. Commit-msg → UTF-8 без BOM + `git commit -F`.  
Стиль: `feat(ohs-7i): …` / `feat(ohs-web): …` / `feat(nc): …` / `docs: …`.

### 8.7. Возможные следующие задачи

Уточнять scope у пользователя. Не стартовать gate/WebGL «заодно».

**Кандидаты (спросить приоритет):**
1. **Baskets / Observed** — реализовать по draft [`baskets-observed.md`](./dev/baskets-observed.md)
   (Available ∪ baskets → hot cache; static/dynamic OPT sticky expand).
2. **Docs commit** — закоммитить накопившийся docs-diff + untracked baskets (если попросят).
3. **Stage 2** — phase 10 Keycloak → phase 11 NC split/MFE.
4. **Production backlog** — [`abandoned`](./dev/stage1/abandoned.md): 7i.S2 pre-flight, 7i.S1 sessions←SCD-2,
   7j.15/16, WG.1, I9; intraday **7c.9/7c.SEC** — не топ.

**Уже DONE (не брать как «хвост Stage 2»):**
- Write Gaps, void mask, soft-delete, crash T/C, startup-latency;
- **7h.OPT / 7i.OPT**, Refresh NC Action/Lifecycle, `instrument.active`;
- NC subtypes; crash pending flush; Connection crash → red error.

### 8.8. Архив: schedule-as-projection (DONE)

Идеология: факты ⊥ mask/Cutter — [`phase8/schedule-projection.md`](./dev/phase8/schedule-projection.md).  
P1 Cutter + P2 void mask + P3–P5 crash/journal — **DONE**; `:h` отклонён.
План шагов — [`phase8/plan-schedule-projection.md`](./dev/phase8/plan-schedule-projection.md).

---

## 9. Справка: провайдеры (phase 7e, DONE)

Управление подключениями из админки — [phase7e/report.md](./dev/phase7e/report.md).

- `ConnectionForm`, `ConnectionToggle` (фазы + **error** при OHS outage; Auto — yellow unreachable),
  `ProviderCard` (+ Refresh справочника)
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
