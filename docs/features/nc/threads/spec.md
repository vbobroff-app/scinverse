# nc / threads

**Часть фичи:** модель контейнеров ленты NC — Single, Entry, Thread и специализации
Incident / Group (+ подтипы). Индекс — [`../main.md`](../main.md).

**Статус:** CANON (2026-08-07). Реализация в коде есть (шина + UI + hints Host);
этот документ — источник истины по группировкам. As-is apply — позже отдельным файлом.

---

## 1. Зачем

Лента — не плоский список атомов, а **лента контейнеров**:

- оператор видит **Single** и **заголовок Thread** на одном вертикальном уровне;
- внутри Thread — стек `Entry` (раскрытие);
- **Incident** и **Group** — специализации Thread с разной **политикой** (duty close / нет);
- подтипы **Crash | Break** и **Lifecycle | Action | Checkup** — **тематика** (не новая политика).

Плоский audit атомов **не отменяется**: каждое событие — строка уведомления.
Thread — **проекция** (v1: клиент / шина); first-class серверная сущность нити — опционально later.

---

## 2. Иерархия

```text
NotificationItem
├── Single          — атом без corr (или corr игнорируется для UI-контейнера)
└── Thread          — контейнер по corr_uid
    ├── Incident                 // threadKind: 'incident' — журнал + duty close
    │   ├── Crash                // incidentKind: 'crash'  (wire: data.kind)
    │   └── Break                // incidentKind: 'break'
    └── Group                    // threadKind: 'group' — не журнал инцидентов
        ├── Lifecycle            // groupKind: 'lifecycle' — периодический / плановый процесс жизни
        ├── Action               // groupKind: 'action' — операционный ход («сделать»)
        └── Checkup              // groupKind: 'checkup' — разовая health-проверка

Entry extends Single { corr_uid }   — атом внутри Thread
```

### 2.1 Оси 

У нити два независимых вопроса — их нельзя смешивать:

1. **Какая это нить по правилам?** (`threadKind`)  
   - **Incident** — «сломалось то, что должно работать»: обязаны довести до закрытия
     (восстановилось / списали).  
   - **Group** — обычная работа или проверка: стек шагов, закрывать не обязательно.

2. **Какой оттенок внутри?** (тематика — не меняет правила выше)  
   - У Incident: **Crash** = упал Host/бэкенд; **Break** = оборвалась конкретная связь.  
   - У Group: **Lifecycle** = плановый цикл (раз в сутки и т.п.);
     **Action** = «сделать» (connect, обновить кэш);  
     **Checkup** = разовая проверка (force Refresh, check-health, …).

Пример: суточный осмотр каталога и кнопка Refresh могут делать похожие шаги
(архив, наборы), но ярлыки разные — потому что один **плановый**, другой **разовый**.
То, что при этом меняются данные в БД, само по себе ярлык не выбирает.

Слово **lifecycle** встречается ещё в двух местах и это **не** то же самое:

| Где услышали | Что имеется в виду |
|--------------|-------------------|
| ярлык Group **Lifecycle** | плановый процесс (`groupKind`) |
| `status` у атома: active / underway / resolved | фаза одного сообщения в стеке |
| «lifecycle каталога» в коде Host | доменная актуализация инструментов |

---

## 3. Базовые типы

### 3.1 Single

| Поле | Источник | Примечание |
|------|----------|------------|
| `uid` / `id` | событие | стабильный id атома |
| `ts`, `severity`, `sourceType`, `module`, `code`, `message`, `data?` | контракт | |
| `status?` | lifecycle атома | для одиночных lifecycle-событий |
| `isFavorite?` | клиент | ★ (часть marks — planned) |
| `isLeft?` | клиент | ⊘ спам; legacy-имя `isLeft` |

**Правило:** нет `correlationId` → всегда `Single`. Есть corr, но политика проекции
не группирует → можно оставить `Single` (исключения — §7).

### 3.2 Entry

`Entry = Single + { corr_uid }`.

- `corr_uid` = `correlationId` события (`subject:uid` или эквивалент).
- В UI: строка стека; subtle `[!]` / `[G]` сдвигает **контент**, не indent карточки.
- Severity-иконка **на Entry**, не на заголовке Thread.

### 3.3 Thread (base)

| Поле | Тип | Примечание |
|------|-----|------------|
| `uid` | string | = `corr_uid` |
| `notifications` | `Entry[]` | по `ts` (+ стабильный tie-break по id) |
| `threadKind` | `'incident' \| 'group'` | политика |
| `incidentKind?` | `'crash' \| 'break'` | только Incident; из `data.kind` / эвристика |
| `groupKind?` | `'lifecycle' \| 'action' \| 'checkup'` | только Group; из `data.groupKind`; **default `action`** |
| `threadStatus` | см. §6 | статус **нити**, ≠ severity |
| `openedAt` | ISO | `ts` первого Entry |
| `closedAt?` | ISO | terminal close |
| `subject?` | string | префикс corr до uid |
| `isFavorite?` / `isLeft?` | bool | агрегаты header: ★=any Entry, ⊘=all Entry |
| `header` | derived | title/summary без severity-иконки |

**Инвариант T1.** Все Entry одного Thread имеют один `corr_uid`.

**Инвариант T2.** В ленте контейнеров Thread занимает **одну** позицию
(рекомендация sortKey: `lastActivityAt`).

**Инвариант T3.** Переклассификация mid-flight
(`threadKind` / `groupKind` / `incidentKind`) **запрещена**.

---

## 4. Incident ⊂ Thread

**Смысл:** это не «ещё одно уведомление», а **эпизод поломки**, который нельзя оставить висеть
без развязки. Пока Incident открыт — система (и оператор) обязаны привести его к концу.

### Когда открываем

Коротко: **связь должна быть живой, а она упала.**

- Расписание / Auto / коннектор говорят: «сейчас канал нужен» (`desired`).
- Фактически связи нет (обрыв link или недоступен Host).
- Тогда открываем Incident и собираем в один стек все шаги этого эпизода
  (lost → reconnecting → recovered / abandoned).

Если связь **не должна** быть (вне горизонта, руками выключили) — это уже не Incident
в смысле duty close (может уйти в Group/audit — см. Open).

### Crash или Break

| Подтип | Пример | wire |
|--------|------------------|------|
| **Crash** | упал сам сервер / бэкенд | `data.kind = crash` → `incidentKind` |
| **Break** | упала конкретная связь с data-сервером | `data.kind = break` → `incidentKind` |

Имя в проводе — `kind`; на Thread то же значение лежит как `incidentKind`.

### Чем заканчивается

Обязателен **terminal** — одно из:

| Outcome | Пример | Лента Connection |
|---------|------------------|------------------|
| `recovered` | снова работает | зелёный 1px |
| `abandoned_schedule` | окно расписания кончилось, так и не ожили | без зелёного |
| `abandoned_manual` | оператор сам списал (later) | без зелёного |

**UI:** бейдж `Incident` + иконка Crash/Break.

---

## 5. Group ⊂ Thread

**Смысл:** стек шагов **обычной работы или проверки**, не журнал поломок.
Можно закрыть красиво (`resolved`), но это не долг как у Incident.

Подтип (`groupKind`) задаётся при открытии нити:

| `groupKind` | Смысл | Критерий | Примеры |
|-------------|--------|----------|---------|
| `lifecycle` | Периодический процесс жизни системы | Планово / по расписанию / раз в сутки | суточный sweep каталога на connect |
| `action` | Операционный ход | «Сделать» | `auto:` / `connect:` success; Refresh «кэш» |
| `checkup` | Разовая health-проверка | Однократный осмотр (не периодический цикл) | force Refresh «актуальность»; check-health; ad-hoc probe |

**Default:** Group без `data.groupKind` → `action`.

```text
если нить = сделать что-то → action   (также default)
если нить = периодический / плановый процесс жизни → lifecycle
если нить = разовая health-проверка (force, check-health, ad-hoc, …) → checkup
```

**UI:** ярлык подтипа (`Action` / `Lifecycle` / `Checkup`), не слово «Group».

### 5.1 Incident или Group — как решаем при старте

При **первом** сообщении нити продюсер говорит: это Incident или Group
(`data.threadKindHint`).

Если hint забыли — запасной путь по коду:

- знакомые «обрыв / Host недоступен» → **Incident**;
- всё остальное → **Group**.

Дальше вид нити **не меняем**: в один `correlationId` нельзя сначала писать Incident,
а потом «перекрасить» в Group (и наоборот). Новый смысл — новый corr.

---

## 6. Статус нити (`threadStatus`)

Отдельно от lifecycle-атома (`active` / `underway` / `resolved`) и от read-state.

| `threadStatus` | Смысл | Типичные Entry |
|----------------|-------|----------------|
| `active` | нить открыта, нет фазы восстановления | open / progress без recovering |
| `recovering` | идёт восстановление | `*.recovering`, reconnecting countdown |
| `resolved` | закрыта (любой terminal) | recovered / incident_closed / abandoned_* |

Вывод (проекция):

```text
если есть terminal close Entry → resolved
иначе если последний «ведущий» lifecycle = recovering/underway-recovery → recovering
иначе → active
```

Фильтр UI «Статус нити»: `active` | `recovering` | `resolved`.

---

## 7. Контракт атома (wire)

Источник истины ленты — поток **атомов** (отдельных уведомлений). Host/клиент шлют атомы;
шина собирает из них Single и Thread.

### 7.0 `correlationId` — зачем

`correlationId` (коротко **corr**) — общий ярлык «это один и тот же эпизод».

- **Нет corr** → сообщение само по себе в ленте (**Single**): клик, короткий info, без стека.
- **Есть corr** → все атомы с этим же значением складываются в один **Thread**
  (заголовок + стек Entry). Открытие, прогресс, закрытие — разные сообщения, одна история.

Обычно вид: `subject:uid`, например `connection:42:link:a1b2c3…` —
«о чём» + уникальный id эпизода. Новый эпизод поломки или новый Refresh → **новый** corr,
даже если subject тот же.

Без общего corr шина не узнает, что «lost» и «recovered» — части одной нити.

Опциональные поля в `data` (подсказки для проекции):

| Поле | Зачем |
|------|--------|
| `data.threadKindHint?` | `'incident'\|'group'` — политика нити |
| `data.kind?` | wire для `incidentKind`: `'crash'\|'break'` (не переименовывать) |
| `data.groupKind?` | `'lifecycle'\|'action'\|'checkup'` — подтип Group |
| `data.closeOutcome?` | `recovered` \| `abandoned_schedule` \| `abandoned_manual` |

### 7.1 Обязанности продюсера (Host)

При Open **Incident** (связь / crash):

- `threadKindHint: incident`
- `kind: crash|break`
- на close — `closeOutcome`

При Open **Group** (каталог, auto/connect success, schedule batch, …):

- `threadKindHint: group`
- `groupKind: lifecycle|action|checkup` (иначе default `action`)

Форма транспорта (WS/REST) — по-прежнему поток атомов (+ hydrate).

### 7.2 Маппинг кодов → роль в нити (ориентир)

| code (пример) | Роль Entry | Влияние на threadStatus |
|---------------|------------|-------------------------|
| `connection.lost`, `backend.unavailable` | open | → active |
| `connection.reconnecting`, progress ticks | progress | active |
| `connection.recovering`, `backend.recovering` | recovering | → recovering |
| `connection.recovered`, `backend.recovered` | close recovered | → resolved |
| `connection.incident_closed` + abandoned_* | close abandoned | → resolved |
| user connect / disconnect | обычно Single или чужой corr | не смешивать с link-incident corr |

Сироты (recovering без open): **не** создавать фейковый open; Thread из одного Entry
или orphan Single; в dev — warn.

---

## 8. Шина и проекция

### 8.1 Что есть сейчас

В `@scinverse/notification-center` живёт **шина** (`NotificationBus`):

- принимает атомы (`publish` / hydrate с сервера);
- держит плоский поток событий (audit, отладка, старые тесты);
- **проецирует** их в ленту контейнеров для UI: Single и Thread.

То есть UI читает уже собранные нити, а не сырой лог — хотя сырой лог никуда не делся.

### 8.2 Целевой вид API

```ts
type NotificationItem = SingleItem | ThreadItem;

interface NotificationBus {
  publish(event: NotificationEvent): void;
  items$: Observable<NotificationItem[]>;   // лента для UI (контейнеры)
  events$: Observable<NotificationEvent[]>; // плоский audit
}
```

### 8.3 Алгоритм проекции `events → items`

1. Разбить по наличию `correlationId`.
2. Группы с corr → Thread; Entry по `ts`.
3. `threadKind` = hint / эвристика (`connection.lost` / `backend.unavailable` → incident; иначе group).
4. `incidentKind` (если incident) = `data.kind` / эвристика `backend.*`→crash, link→break.
5. `groupKind` (если group) = `data.groupKind`; иначе **`action`**.
6. `threadStatus` по §6.
7. Без corr → Single.
8. Merge Single + Thread по `lastActivityAt`.

Ориентир в коде: `projectThreads`, types Single/Thread/Entry;
Host — `NotificationThreadData.WithHints`, продюсеры Group/Incident.

---

## 9. UI-контракт

### 9.1 Список

```text
[ Single ]
[ Thread header ]          ← custom content, БЕЗ severity-иконки
  [ Entry ]                ← при expand
  [ Entry ]
[ Single ]
```

- Collapse Thread = скрыть стек Entry.
- Заголовок: summary (subject; kind badge Incident или Action/Lifecycle/Checkup;
  threadStatus; время open→last / close; ★ / ⊘).
- Entry: severity icon, message, expand JSON, свои ★ / ⊘.

### 9.2 Фильтры

| Фильтр | Область |
|--------|---------|
| severity / sourceType / module / search | атомы и/или заголовок |
| thread status | Thread: active / recovering / resolved |
| «Выбор» | ★ include / ⊘ exclude — часть marks (planned) |

### 9.3 Цвет / иконки (v1)

- Border/фон по read + lifecycle атома — на **Entry** и **Single**.
- Thread: нейтральный фон панели; цвет статусной плашки
  `active`≈error / `recovering`≈warning / `resolved`≈info; без левой полоски.
- Иконка Incident моргает при `active`/`recovering`, статична при `resolved`.
- Иконка Group — приглушённый tint по severity **последнего** Entry, без моргания.

---

## 10. Персист и журнал

**v1 (projection-first):** отдельной таблицы нитей нет.
Hints живут в `data` jsonb атома (`notification`). Thread восстанавливается группировкой
по `correlation_id`.

**Later:** серверный журнал инцидентов — first-class строки (часть `journal/` фичи nc);
Single в журнал **не** пишется. Enum `thread_kind ∈ {incident, group}` стабилен уже в hints.

---

## 11. Совместимость

1. События без `threadKindHint`: эвристика §8; unknown → `group`, кроме известных
   link/crash open-кодов → `incident` (зафиксировано в тестах проекции).
2. Upsert progress-тиков — на уровне атомов; UI показывает полный стек.
3. Клик по corr → expand+focus Thread.
4. Старые resolved на длинном бэклоге — follow-up perf (сжатый вид), не блокер модели.

---

## 12. Acceptance

1. Спека Single / Entry / Thread / Incident / Group (+ подтипы) согласована (этот документ).
2. Лента UI = контейнеры; Thread header без severity-иконки; Entry со стеком.
3. Incident vs Group по hint/горизонту на Open; Group не продолжает Incident.
4. Фильтр `threadStatus` работает; marks ★/⊘ — отдельная часть.
5. Плоский audit атомов не ломается; таблица нитей не обязательна для UI.
6. Тесты проекции: lost→recovering→recovered; schedule abandon; orphan recovering; Single без corr.
7. Каталог: суточный sweep → Group Lifecycle; Refresh актуальность → Group Checkup;
   Refresh кэш → Group Action.

---

## 13. Open

| # | Вопрос | Рекомендация |
|---|--------|--------------|
| Q1 | FATAL crash вне горизонта — Group или глушить? | Group (audit), не Incident |
| Q2 | sortKey ленты | `lastActivityAt` |
| Q3 | unread на collapsed Thread | unread, пока есть unread Entry |
| Q4 | ★/⊘ в БД | не в v1 threads; marks / user_settings |
| Q5 | adopt break после crash Host | не смешивать с Thread-моделью; Host adopt |
