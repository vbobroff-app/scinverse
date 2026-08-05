# Phase 11 — Проектирование: Thread / Incident / Group

Статус: **IMPLEMENTED** (11.8–11.12 + подтипы 2026-08-05). Обновлено: 2026-08-05.

Проблема: [issue.md](issue.md). Персист атомов: [persistence.md](persistence.md) (V025).
Домен инцидентов связи: [../phase7j/incident.md](../phase7j/incident.md).
**Журнал инцидентов (11.13):** канон — [../phase8/incident-journal.md](../phase8/incident-journal.md)
(таблица `incident` в **OHS**; atoms/`notification` → NC на gate 11→12). §6.3 — черновик полей.
Soft-delete (видимость ⊥ ThreadStatus) — [incident-soft-delete.md](incident-soft-delete.md);
фильтр Выбор «Удалённые» — [nc-marks.md](nc-marks.md).

---

## 1. Цель

Перейти от «лента = список атомов» к **ленте контейнеров**:

- оператор видит **Single** и **заголовок Thread** на одном вертикальном уровне;
- внутри Thread — стек `Entry` (раскрытие);
- **Incident** и **Group** — специализации Thread с разной **политикой** (duty close / нет);
- подтипы **Crash|Break** и **Lifecycle|Action|Checkup** — **тематика** (не новая политика).

Плоский audit в Timescale **не отменяем**: каждое событие по-прежнему строка `notification`.
Thread — **проекция** (v1 клиент / шина), later — опциональная серверная сущность.

---

## 2. Иерархия сущностей

```text
NotificationItem
├── Single          — атом без corr (или corr игнорируется для UI-контейнера)
└── Thread          — контейнер по corr_uid
    ├── Incident                 // threadKind: 'incident' — журнал + duty close
    │   ├── Crash                // incidentKind: 'crash'  (wire: data.kind)
    │   └── Break                // incidentKind: 'break'
    └── Group                    // threadKind: 'group' — не журнал инцидентов
        ├── Lifecycle            // groupKind: 'lifecycle' — смена состояния домена
        ├── Action               // groupKind: 'action' — операционный ход («сделать»)
        └── Checkup              // groupKind: 'checkup' — мониторинг / health-probe

Entry extends Single { corr_uid }   — атом внутри Thread
```

Оси ортогональны: `threadKind` = **политика** нити; `incidentKind` / `groupKind` = **тематика**.
Incident-подтип = *что сломалось* (Host vs link). Group-подтип = *зачем нить*
(мутация домена / ход / осмотр). Подтип Group `lifecycle` ≠ lifecycle-атома
(`NotificationStatus`) и ≠ доменный `InstrumentLifecycle`.

### 2.1 Single

Поля (как сейчас + UI-метки):

| Поле | Источник | Примечание |
|------|----------|------------|
| `uid` / `id` | событие | стабильный id атома |
| `ts`, `severity`, `sourceType`, `module`, `code`, `message`, `data?` | контракт | без изменений |
| `status?` | lifecycle атома | для одиночных lifecycle-событий |
| `isFavorite?` | клиент | ★, не в V025 v1; см. [nc-marks.md](nc-marks.md) |
| `isLeft?` | клиент | ⊘ спам (поле `isLeft` — legacy-имя), не в V025 v1 |

**Правило:** нет `correlationId` → всегда `Single`. Есть corr, но в проекции решено не группировать
(whitelist кодов / политика) → можно оставить `Single` (исключения — в §5).

### 2.2 Entry

`Entry = Single + { corr_uid }`.

- `corr_uid` = `correlationId` события (`subject:uid` или эквивалент).
- В UI: строка стека; subtle `[!]` / `[G]` сдвигает **контент**, не indent карточки.
- Severity-иконка **на Entry** (как сейчас на атоме), не на заголовке Thread.

### 2.3 Thread (base)

| Поле | Тип | Примечание |
|------|-----|------------|
| `uid` | string | = `corr_uid` |
| `notifications` | `Entry[]` | упорядочены по `ts` (и стабильный tie-break по id) |
| `threadKind` | `'incident' \| 'group'` | политика |
| `incidentKind?` | `'crash' \| 'break'` | только Incident; из `data.kind` / эвристика кодов |
| `groupKind?` | `'lifecycle' \| 'action' \| 'checkup'` | только Group; из `data.groupKind`; **default `action`** |
| `threadStatus` | см. §3 | статус **нити**, не копия severity |
| `openedAt` | ISO | `ts` первого Entry (обычно open) |
| `closedAt?` | ISO | terminal close |
| `subject?` | string | префикс corr до uid (`connection:{id}:link`) |
| `isFavorite?` / `isLeft?` | bool | агрегаты header: ★=any Entry, ⊘=all Entry ([nc-marks.md](nc-marks.md)) |
| `header` | derived | title/summary для заголовка без severity-иконки |

**Инвариант T1.** Все Entry одного Thread имеют один `corr_uid`.

**Инвариант T2.** В ленте контейнеров Thread занимает **одну** позицию (по `openedAt` или
`lastActivityAt` — выбрать в 11.9; рекомендация: `lastActivityAt` для live-хвоста).

### 2.4 Incident ⊂ Thread

Условия открытия (согласовано с phase 7j):

- стек заведён, когда связь **должна** быть (`desired` / расписание / connector running);
- подтипы **Crash** (Host outage) и **Break** (link) — `incidentKind`; wire остаётся
  `data.kind` (`crash` \| `break`), на Thread проецируется как `incidentKind`;
- обязательный terminal.

Terminal outcomes:

| Outcome | Смысл | UI / ribbon (связь) |
|---------|--------|---------------------|
| `recovered` | связь восстановлена | зелёный 1px на ленте Connection |
| `abandoned_schedule` | горизонт закончился, не recovered | без зелёного |
| `abandoned_manual` | позже: оператор сбросил | без зелёного |

**Политика:** открытый Incident **нельзя** «забыть» — только recovered или abandoned_*.

### 2.5 Group ⊂ Thread

- Та же форма стека (`Entry[]` + `threadStatus`); **не** журнал инцидентов.
- Исторически «вне горизонта» (зеркало Incident); на практике — progress-стеки
  non-incident работы. Подтип задаёт `groupKind` на Open.
- Close outcomes допустимы, но **не обязательны**.
- Переклассификация mid-flight (`threadKind` / `groupKind` / `incidentKind`) **запрещена**.

| `groupKind` | Смысл | Критерий | Примеры |
|-------------|--------|----------|---------|
| `lifecycle` | Смена состояния домена | Мутация каталога (архив по exp) | Refresh corr «актуальность» |
| `action` | Операционный ход | «Сделать»: connect, refresh dump, batch schedule | `auto:` / `connect:` success; Refresh «кэш» |
| `checkup` | Мониторинг / health-probe | «Проверить»; часто регулярно; без обязательной мутации | задел (суточный осмотр каталога и т.п.) |

**Default:** Group без `data.groupKind` → `action` (проекция и `WithHints` при `threadKindHint=group`).

```text
если нить = сделать что-то → action   (также default)
если нить = осмотр/зонд здоровья → checkup
если нить = жизненный цикл сущностей каталога → lifecycle
```

**UI (реализовано 2026-08-05):** в заголовке Thread для Group показывается ярлык подтипа
(`Action` / `Lifecycle` / `Checkup`), не слово «Group». Incident по-прежнему бейдж
`Incident` + иконка Crash/Break по `incidentKind`.

Классификация Incident vs Group (политика):

```text
на Open: threadKindHint от продюсера / Hub;
  fallback — whitelist open-кодов link/crash → incident, иначе group
```

---

## 3. Статус нити (`threadStatus`)

Отдельно от lifecycle-атома (`active` / `underway` / `resolved`) и от read-state.

| `threadStatus` | Смысл | Типичные Entry |
|----------------|-------|----------------|
| `active` | нить открыта, нет фазы восстановления | open / progress без recovering |
| `recovering` | идёт восстановление | `*.recovering`, reconnecting countdown |
| `resolved` | закрыта (любой terminal) | recovered / incident_closed / abandoned_* |

Фильтр UI «Статус нити»: `active` | `recovering` | `resolved` (≠ bounded только по severity).

Вывод `threadStatus` (проекция):

```text
если есть terminal close Entry → resolved
иначе если последний «ведущий» lifecycle = recovering/underway-recovery → recovering
иначе → active
```

Детали кодов — таблица маппинга в §5.2.

---

## 4. UI-контракт (док)

### 4.1 Список

Один вертикальный поток **контейнеров**:

```text
[ Single ]
[ Thread header ]          ← custom content, БЕЗ severity-иконки
  [ Entry ]                ← при expand; [!]/[G] сдвигает контент
  [ Entry ]
[ Single ]
```

- Collapse Thread = скрыть весь стек Entry.
- Заголовок Thread: summary (subject; kind badge **Incident** или **Action/Lifecycle/Checkup**;
  threadStatus; время open→last / close), ★ / ⊘ (bulk; см. [nc-marks.md](nc-marks.md)).
- Entry: строка + свои ★ / ⊘ (severity icon, message, expand JSON).

### 4.2 Фильтры (дополнение к существующим)

| Фильтр | Область |
|--------|---------|
| severity / sourceType / module / search | атомы и/или заголовок (search по Entry+header) |
| thread status | только Thread: active / recovering / resolved |
| «Выбор» | ★ include / ⊘ exclude (асимметрия) — [nc-marks.md](nc-marks.md) |

Бейдж / unread Entry: непрочитан, если severity alert и не read и Entry не ⊘
([nc-marks.md](nc-marks.md)).

### 4.3 Что не меняем в v1 UI

- Цветовая модель border/фона по read + lifecycle атома — на **Entry** и на **Single**.
- Thread: нейтральный фон панели; цвет — у статусной плашки `active`≈error /
  `recovering`≈warning / `resolved`≈info (голубой), без левой полоски.
  Иконка Incident (break/crash) моргает при `active`/`recovering`, статична при
  `resolved`.   Иконка Group красятся по severity **последнего** Entry — приглушённый
  tint как у фона строки, чуть светлее (~#566b84 / warning / #8e5b60 / #476455),
  без моргания.

---

## 5. Изменения по слоям

### 5.1 Контракт события (атом) — минимальные правки

Текущий `NotificationEvent` / `NotificationDto` **остаётся** источником истины.

Опциональные поля (добавить при необходимости, без ломки):

| Поле | Зачем |
|------|--------|
| `data.threadKindHint?` | `'incident'\|'group'` — политика нити |
| `data.kind?` | wire для `incidentKind`: `'crash'\|'break'` (не переименовывать) |
| `data.groupKind?` | `'lifecycle'\|'action'\|'checkup'` — подтип Group |
| `data.closeOutcome?` | `recovered` \| `abandoned_schedule` \| `abandoned_manual` |

`correlationId` обязателен для Entry/Thread; без него — Single.

### 5.2 Шина `@scinverse/notification-center`

Сейчас: `NotificationBus` держит плоский массив, upsert по corr (I2).

**Целевой API:**

```ts
type NotificationItem = SingleItem | ThreadItem;

interface NotificationBus {
  // publish атома как сейчас
  publish(event: NotificationEvent): void;
  // проекция для UI
  items$: Observable<NotificationItem[]>;  // или derived selector
  events$: Observable<NotificationEvent[]>; // плоский audit (отладка / совместимость)
}
```

Алгоритм проекции `events → items`:

1. Разбить по наличию `correlationId`.
2. Группы с corr → Thread; упорядочить Entry по ts.
3. `threadKind` = hint из data / эвристика (если нет hint: коды `connection.lost` /
   `backend.unavailable` → incident; иначе group).
4. `incidentKind` (если incident) = `data.kind` / эвристика `backend.*`→crash, link→break.
5. `groupKind` (если group) = `data.groupKind`; иначе default **`action`**.
6. `threadStatus` по §3.
7. События без corr → Single.
8. Merge Single + Thread в один список по `sortKey` (lastActivity).

**Переходный период:** UI может читать `items$`; старые тесты — `events$` / `statusOf`.

Файлы (ориентир):

- `packages/notification-center/src/bus/NotificationBus.ts` — проекция
- `packages/notification-center/src/types.ts` — Single / Thread / Entry
- новые: `projectThreads.ts`, тесты проекции
- UI: `NotificationDock.tsx`, `NotificationRow.tsx` → `ThreadHeader` + `EntryRow`

### 5.3 OHS web

- `OhsStore` / `publishServerNotification` — без смены wire; опционально прокидывать
  `threadKindHint` / `closeOutcome` когда Host начнёт слать.
- Локальные клиентские события (optimistic) — те же атомы; проекция подхватит.
- Метки ★/⊘: `localStorage` или `user_settings` (phase 10) — ключ `nc.marks[id]`;
  правила UI/фильтра — [nc-marks.md](nc-marks.md).

### 5.4 Backend (Host)

**Обязательно для корректной политики Incident/Group:**

- при `Open` инцидента связи/crash писать в `data`:
  - `threadKindHint: incident|group`,
  - `kind: crash|break` (wire для `incidentKind`),
  - для close — `closeOutcome`.
- при Open **Group** (Refresh каталога, auto/connect success, schedule batch):
  - `threadKindHint: group`,
  - `groupKind: lifecycle|action|checkup` (если не указан — Hub/`WithHints` → default `action`).
- Не менять форму WS/REST: по-прежнему поток атомов (+ hydrate из БД).

**Не обязательно в v1:** таблица `notification_thread` (см. §6).

Файлы-ориентир: `NotificationHub.cs`, `NotificationThreadData.WithHints`, продюсеры
`ConnectionManager` / `ConnectionSupervisor` / `CatalogRefreshNc`, ingest crash.

### 5.5 Маппинг кодов → роль в нити (черновик)

| code (пример) | Роль Entry | Влияние на threadStatus |
|---------------|------------|-------------------------|
| `connection.lost`, `backend.unavailable` | open | → active |
| `connection.reconnecting`, progress ticks | progress | active |
| `connection.recovering`, `backend.recovering` | recovering | → recovering |
| `connection.recovered`, `backend.recovered` | close recovered | → resolved |
| `connection.incident_closed` + abandoned_* | close abandoned | → resolved |
| user `connection.connect` / disconnect | обычно Single или чужой corr | не смешивать с link-incident corr |

Сироты (recovering без open в бэклоге): проекция → Thread `active`/`recovering` с одним Entry
**или** orphan Single с пометкой; рекомендация: **не** создавать фейковый open; UI: Thread из
одного Entry + warn в dev.

---

## 6. Структура БД

### 6.0 Почему не меняем таблицы в DB

**Таблицы / колонки не добавляем.** Колонка `data` (JSONB) в `notification` покрывает наши
изменения в объектной модели:

- `data.threadKindHint` — Incident vs Group (политика) на open;
- `data.kind` — wire `incidentKind` (`crash`|`break`);
- `data.groupKind` — подтип Group (`lifecycle`|`action`|`checkup`);
- `data.closeOutcome` — чем закрылся стек на close.

Thread / Incident / Group (+ подтипы) — проекция над атомами (`correlation_id` + поля в `data`),
не отдельная сущность схемы. Новая таблица или ALTER — только если позже понадобится
first-class журнал нитей (вариант B).

### 6.1 Как сейчас (остаётся)

`notification` (V025, hypertable, retention 90d) — **плоский audit**.  
Поля: id, ts, severity, source_type, module, code, message, **data jsonb**, correlation_id, status, …

Thread **не** хранится отдельной строкой; восстанавливается группировкой по `correlation_id`
и чтением меток из `data`.

### 6.2 Вариант A — projection-first (рекомендация v1)

**Миграций схемы нет** — см. §6.0: хватает колонки `data`.

- Hydrate: `GET /api/notifications` → плоский список → клиент/`NotificationBus` строит Threads.
- Серверный «журнал инцидентов»: SQL `WHERE correlation_id IS NOT NULL AND …` + фильтр по
  `data->>'threadKindHint' = 'incident'` (после появления hint).
- Индекс `(correlation_id, ts DESC)` уже есть в V025; отдельная миграция не нужна.

Плюсы: нет рассинхрона thread↔atoms; проще.  
Минусы: тяжёлая агрегация на больших окнах; нет first-class API «список инцидентов».

### 6.3 Вариант B — производная таблица «журнал нитей» (переходный эскиз)

> **2026-07-29:** целевой журнал — таблица `incident` в **OHS** (рядом с `link_liveness`).
> Поток atoms (`notification`) — в **NC** (gate 11→12). Канон —
> [incident-journal.md](incident-journal.md). Ниже — исторический набросок полей.

Когда понадобится серверный **журнал инцидентов** (пагинация, фильтры, метрики без скана
атомов) — first-class строки нитей (одна строка = один Thread / Incident).

#### Что индексируем: не `single`

Объектная модель UI: `Single | Thread(Incident|Group)`.

| Вид | В журнале? | Как хранится |
|-----|------------|--------------|
| **Single** | **нет** | только атом в `notification` (`correlation_id IS NULL`) |
| **Incident** | да | строка `notification_thread` с `thread_kind = 'incident'` |
| **Group** | да | строка с `thread_kind = 'group'` |

`single` **не** значение колонки журнала: одиночные notify не попадают в производную таблицу.
Фильтр «журнал инцидентов» = `WHERE thread_kind = 'incident'` (Group — отдельный список / отчёт).

#### Почему колонка, а не только `data` jsonb

На атомах hint в `data.threadKindHint` достаточен для клиентской проекции (вариант A).
Для журнала нужен **типизированный индексируемый** атрибут:

```text
thread_kind  NOT NULL  CHECK (IN ('incident', 'group'))
INDEX (thread_kind, thread_status, last_activity_at DESC)
```

Фильтр по `data->>'threadKindHint'` на hypertable атомов — плохой путь для списка нитей
(скан/agg + JSON path). Производная таблица + btree по `thread_kind` — правильный.

Источник kind при Open: горизонт расписания → пишем и в `data` атома (audit), и в колонку
thread-строки (журнал). Они должны совпадать.

```sql
-- эскиз V02x__notification_thread.sql  (= журнал нитей / инцидентов)
CREATE TABLE notification_thread (
  corr_uid          text PRIMARY KEY,
  subject           text,
  -- индексируемый вид нити (НЕ включает single — Single в эту таблицу не пишем)
  thread_kind       text NOT NULL CHECK (thread_kind IN ('incident', 'group')),
  thread_status     text NOT NULL CHECK (thread_status IN ('active', 'recovering', 'resolved')),
  close_outcome     text NULL,  -- recovered | abandoned_schedule | abandoned_manual
  opened_at         timestamptz NOT NULL,
  closed_at         timestamptz NULL,
  last_activity_at  timestamptz NOT NULL,
  module            text,
  title             text,
  severity_peak     text
);

-- Журнал инцидентов: kind=incident + статус + свежесть
CREATE INDEX ix_notification_thread_journal
  ON notification_thread (thread_kind, thread_status, last_activity_at DESC);
```

Связь с атомами: `notification.correlation_id = notification_thread.corr_uid` (мягкая, без FK на
hypertable). Writer обновляет thread в той же транзакции, что insert open/progress/close атома.

**Writer (PersistWriter / Hub):**

- Open (есть corr + kind) → UPSERT thread (`thread_kind`, status=active, opened_at);
- Progress/Recovering → update status + last_activity;
- Resolve → status=resolved, close_outcome, closed_at;
- атом без corr → **только** `notification`, thread-строки нет.

API: `GET /api/notification-threads?kind=incident&status=active` (журнал инцидентов).

Retention: не hypertable; чистить orphan threads по `closed_at` + N дней (или когда атомы
ушли за retention V025).

### 6.4 Решение по БД для плана

| Этап | БД |
|------|-----|
| 11.8–11.10 (модель + UI) | **A** — без новой таблицы; hint/outcome в `data` jsonb |
| 11.11 | hints в `data` (обязательно); **задел контракта** `thread_kind ∈ {incident,group}` |
| **когда заводим серверный журнал** | **B′** — таблица `incident` в **OHS** ([incident-journal.md](incident-journal.md)); V025 atoms без ALTER; cutover atoms → NC на gate |

### 6.5 Когда именно разумно заводить журнал (B′)

**Не** вместе с UI Thread (11.8–11.10) и **не** «на всякий случай» при первых hints в `data`.

**Триггер (выполнен — стартуем проектирование 11.13):** нужен экран/API **«Журнал инцидентов»**
и/или серверные фильтры по нитям без `GROUP BY` по hypertable атомов.

**До cutover atoms в NC:** лента остаётся на варианте A (`notification` + `data` в OHS).
Журнал эпизодов (`incident`) — отдельно в OHS (11.13). Enum `incident|group` в hints стабилен.

**Не повод трогать V025:** клиентский expand Thread, ★/⊘, фильтр статуса нити на шине.

---

## 7. Совместимость и миграция поведения

1. Старые события без `threadKindHint`: эвристика §5.2; unknown → `group` (безопаснее, чем
   раздувать журнал инцидентов) **или** `incident` для известных link/crash open-кодов в окне —
   зафиксировать в тестах проекции.
2. I2 upsert тиков: остаётся на уровне атомов; UI показывает один Entry «текущий progress» или
   полный стек (продуктово: **полный стек**, upsert только заменяет id тика — как сейчас).
3. Фильтр по corr (клик) → expand+focus Thread, не только flat filter.
4. Бэклог 90d: проекция на клиенте ограничивает число Thread (например merge старых resolved в
   «сжатый» вид) — follow-up perf, не блокер дизайна.

---

## 8. Критерии приёмки проектирования → реализации

1. Спека сущностей Single / Entry / Thread / Incident / Group согласована (этот документ).
2. Лента UI = контейнеры; Thread header без severity-иконки; Entry со стеком.
3. Incident vs Group по горизонту на Open; Group не продолжает Incident.
4. Фильтры threadStatus + Выбор (★/⊘) — [nc-marks.md](nc-marks.md).
5. V025 audit не ломается; миграция thread-таблицы не обязательна для UI.
6. Тесты проекции: lost→recovering→recovered; schedule abandon; orphan recovering; Single без corr.

---

## 9. Открытые вопросы

| # | Вопрос | Рекомендация |
|---|--------|--------------|
| Q1 | FATAL crash **вне** горизонта — открывать Group в NC или глушить? | Group (audit), не Incident; продукт уточнит |
| Q2 | sortKey ленты: `openedAt` vs `lastActivityAt` | `lastActivityAt` |
| Q3 | unread на collapsed Thread | unread пока есть unread Entry |
| Q4 | где журнал / схема | **`incident` в OHS** — [incident-journal.md](incident-journal.md); atoms → NC (gate) |
| Q5 | хранить ★/⊘ в БД | нет в v1; local / user_settings ([nc-marks.md](nc-marks.md)) |
| Q6 | после crash Host: break `active` + восстановление в `auto:` Group | **не Thread** — adopt на Host (**I10 КОД ГОТОВ**); [../phase7j/issue.md](../phase7j/issue.md) |
