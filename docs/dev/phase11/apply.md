# Phase 11. Особенности реализации

Конкретные решения фазы 11. Обзор — в [plan.md](plan.md), статус — в [report.md](report.md).
Заполняется по ходу реализации; ниже — зафиксированные проектные заметки.

## Пакет `@scinverse/notification-center`

Независимый UI+шина в `packages/notification-center` (peer: `react`, `rxjs`).
OHS и другие сервисы подключают пакет; адаптеры транспорта (WS/REST/другой контур) живут у хоста.
MFE-обёртка — отдельный следующий шаг поверх того же API.

Публичный API (`packages/notification-center/src/index.ts`):

| Экспорт | Назначение |
| ------- | ---------- |
| `NotificationEvent`, severity/sourceType | контракт события (`ts` = ISO; без секретов) |
| `NotificationBus` / `createNotificationBus` | ring-buffer, дедуп по `id`, `stream$`, unread alerts |
| `notify.info\|warn\|error\|critical` | сахар publish с авто `id`/`ts` |
| `filterEvents` | клиентская фильтрация ленты |
| `formatTsUtc` / `createOffsetFormatTs` | отображение времени; хост передаёт свой форматтер |
| `NotificationDock` | нижний док (collapse / resize / filters / tail / copy) |

### Время отображения

Хранение — ISO в `event.ts`. Отображение — проп `formatTs` (из системной настройки хоста:
UTC / МСК / UTC+N). Без пропа — UTC. Пакет не знает о `DisplayTz` / `OhsStore`.

Пример хоста OHS (подключение — следующий шаг):

```ts
const formatTs = createOffsetFormatTs(store.displayTz$.value.offsetMin);
<NotificationDock bus={notificationBus} formatTs={formatTs} />
```

### Шина

- Хост создаёт `createNotificationBus({ limit: 1000 })` (singleton на приложение — решение хоста).
- `publish` / `publishMany` — из user-действий, WS, REST-бэклога или внешнего сервиса.
- `publishMany`: порядок массива = новые сверху; для REST oldest-first хост разворачивает массив.
- Бейдж: непрочитанные только `error` + `critical`.

### UI док

- Сворачивание, resize за верхний край, live-tail (пауза при скролле вниз списка), фильтры
  severity/sourceType/module + поиск, раскрытие строки → `data` JSON, copy.
- Стили — CSS modules с fallback на `--color-*` хоста (совместимо с OHS `variables.css`).
- Виртуализация длинной ленты — follow-up.

## Контракт события

TypeScript (пакет):

```ts
export type NotificationSeverity = 'info' | 'warning' | 'critical' | 'error';
export type NotificationSourceType = 'user' | 'system' | 'external';
export type NotificationStatus = 'active' | 'underway' | 'resolved'; // ось B (см. ниже)

export interface NotificationEvent {
  id: string;
  ts: string;                 // ISO-8601
  severity: NotificationSeverity;
  sourceType: NotificationSourceType;
  status?: NotificationStatus; // отсутствует ⇒ active
  module: string;
  code: string;
  message: string;
  data?: Record<string, unknown>;
  correlationId?: string;     // ключ инцидента для upsert перехода статуса
}
```

> Фактический контракт пакета богаче сниппета выше: `severity` включает `ok`, а помимо `sourceType`
> есть `interaction` (`user|system|resolving`) и `localization` (`internal|external`) с резолвом по
> умолчанию (`resolveInteraction`/`resolveLocalization`). Ниже добавляется ещё поле `status` (ось B).

C# (бэк, `Scinverse.Ohs.Contracts`) — позже, вместе с 11.2: зеркальный `record NotificationEvent(...)`.

## Оси состояния: read-state + lifecycle status (11.1a)

Два **ортогональных** измерения — не смешивать в один enum:

| Ось | Значения | Где живёт | На контракте? |
| --- | -------- | --------- | ------------- |
| **A · read-state** | `unread` / `read` | `NotificationBus.readIds` (per-user, эфемерно) | **Нет** |
| **B · lifecycle** | `active` / `underway` / `resolved` | поле `status` события | **Да** (default `active`) |

- **Ось A** остаётся вне контракта: «прочитано» — состояние конкретного оператора; серверная
  синхронизация read между устройствами — это phase 10 (`user_settings`), в тонкий hub не входит.
- **Ось B** — новое поле `status`. Заменяет прежнее протаскивание жизненного цикла в
  `interaction: 'resolving'` (это «кто действует», а не «состояние инцидента»). Демо-seed правится.

### Владелец жизненного цикла — один, на бэке

Инциденты с ЖЦ (`connection.lost→recovered`, `coverage.gap→healed`, `reconnecting`) — это
**backend-условия** (правду о связи/покрытии/БД знает бэк). Значит state-machine держит **backend
hub**. Фронтовая шина — **проекция**: на ingest делает upsert по `correlationId`, своей машины
состояний не держит. Две машины не заводим (иначе спор при реконнекте / replay бэклога).
Исключение — чисто фронтовые инциденты (UI-действие в процессе) — отдельная ветка.

### Где лежит состояние (thin = in-memory)

- **ring-buffer** — показ ленты (как сейчас, вытесняет старое).
- **`openIncidents: Map<correlationId, OpenIncident>`** — маленькая карта *открытых* инцидентов;
  запись удаляется при `resolved` (или по TTL). Переходы грузят состояние **отсюда**, не из ленты
  (лента может вытеснить `underway` до прихода `resolve`).

### Машина состояний и API (явные хелперы)

```text
open:     ∅ → active,  underway → active (re-open),  active → active (идемпотентный upsert)
progress: active → underway,  underway → underway (no-op)
resolve:  active → resolved,  underway → resolved,  resolved → resolved (no-op)
```

Переход вне таблицы (напр. `progress` после `resolved`) → **контролируемый no-op + debug-лог**, не
throw: дубли WS / REST-бэклога штатны (реконнект, подтягивание истории при загрузке).

**Инварианты:**

- **I1 — `resolved` терминален.** Рецидив *после* `resolved` = **новый инцидент с новым
  `correlationId`** (хаб снимает subject из `openIncidents` и повторный `Open` генерит новый uid).
  Флап допустим только `active ↔ underway`.
- **I2 — новая строка только на смену статуса.** Дедуп подряд идущих одинаковых `(status, code)` в
  рамках `correlationId`: строка добавляется, лишь когда статус реально изменился (иначе `active`
  каждые 15 с забьёт ленту). Флап даёт `active → underway → active` = 3 осмысленные строки.

### `correlationId` = `subject:uid` (per-occurrence)

Продюсер не задаёт `correlationId` напрямую — он передаёт **subject** (стабильный квалификатор
условия): `connection:{id}:link`, `coverage:{instrumentId}:{sourceId}:gap`. Хаб на `Open` генерит
`correlationId = {subject}:{uid}` (uid = 8 hex от `Guid`), напр. `connection:42:link:a1b2c3d4`.
`Progress`/`Resolve` находят открытый инцидент по subject и переиспользуют его `correlationId`.

Зачем uid: каждый **экземпляр инцидента** уникален. Инвариант I1 (рецидив после `resolved` =
новый инцидент) реализуется автоматически — повторный `Open` того же subject даёт новый uid.
Это даёт две гранулярности поиска в ленте:

- клик по `corr` в строке → фильтр по полному id → история одного конкретного инцидента;
- ввод subject-префикса (`connection:42:link`) в поиск → все инциденты связи этого подключения.

### Продюсер connection (7j / 11.6)

Первый живой продюсер ленты — жизненный цикл связи подключения:

| Событие | Метод хаба | severity / status | corr | Источник |
| ------- | ---------- | ----------------- | ---- | -------- |
| потеря связи (`Down`/`Error` от коннектора) | `Open` | `error` / active | `connection:{id}:link:{uid}` | `ConnectionManager.HandleLinkStateAsync` |
| попытка реконнекта | `Progress` | `warning` / underway | тот же link-инцидент | `ConnectionSupervisor` |
| восстановление | `Resolve` | `ok` / resolved | тот же link-инцидент | `ConnectionManager` |
| **connect: команда оператора** (REST) | `Publish` | `info`, `user` | — (дискретная) | эндпоинт `/connect` |
| **connect: устанавливаю** (REST) | `Publish` | `warning` / underway, `system` | `connection:{id}:connect:{uid}` | эндпоинт `/connect` |
| **connect: связь установлена** | `Publish` | `ok` / resolved, `system` | тот же connect-attempt | эндпоинт `/connect` |
| **connect: не удалось** | `Publish` | `error`, `system` | тот же connect-attempt | эндпоинт `/connect` |
| **disconnect оператором** (REST) | `Publish` + `Resolve` | `info`, `user` | — (+ resolve link) | эндпоинт `/disconnect` |

- **Команда vs исполнение (атрибуция user/system):** «кто инициировал» ≠ «кто исполняет».
  Оператор жмёт «подключить» → сперва дискретное `connection.connect` (**info, user**) —
  «подключение по команде оператора» (симметрично `connection.disconnect`). Далее установку ведёт
  **система**: `connection.connecting` (**warning/underway, system**), затем `connection.connected`
  (**ok/resolved, system**) или `connection.connect_failed` (**error, system**). Коды успеха/ошибки
  совпадают с авто-путём `ConnectionSupervisor` (единый словарь для ручного и планового connect).
- **Фаза connect как мини-ЖЦ (QUIK-опыт):** `connecting`→`connected`/`connect_failed` связаны общим
  `correlationId = connection:{id}:connect:{uid}` → одна строка в NC меняет цвет жёлтый→зелёный/красный
  (Publish-путь: собственная группа продюсера, минуя incident-оркестратор).
- **«Предыдущее подключение» (QUIK-style):** в сообщение об успехе `connect` дописывается хвост из
  `ILinkLivenessStore.GetLastAsync(sourceId)` — «Предыдущее подключение — dd.MM.yyyy HH:mm МСК; пред.
  сеанс — <причина закрытия>» (или «Первое подключение.»). Читается **до** `ConnectAsync`, иначе
  последним интервалом станет только что открытый сеанс. Машиночитаемо — в `data.lastConnectedAt` /
  `lastCloseReason`.
- **Атрибуция user vs system:** действия оператора публикуются в **эндпоинтах** (`/connect`,
  `/disconnect`); авто-подключение по расписанию (`ConnectionSupervisor`) идёт мимо эндпоинта и
  остаётся `system`.
- **Оператор закрывает инцидент:** ручной `/disconnect` дополнительно зовёт `Resolve` того же
  subject — открытый `connection.lost` не «висит» красным. `Resolve` идемпотентен: нет инцидента —
  no-op, лишней строки нет.
- **Гард teardown:** `HandleLinkStateAsync` игнорирует событие связи, если по подключению нет
  активной сессии (`DisconnectAsync` снимает сессию до `StopAsync`). Иначе `Down`, прилетевший при
  штатной остановке, породил бы ложный `connection.lost` (проверка `wasUp` этого не ловит:
  при `hadState=false` она всё равно true).
- **Сериализация link-state (фикс гонки `recovered`):** `ConnectorSession` теперь **await**-ит
  `onLinkState` в pump-цикле (было fire-and-forget `_ = HandleLinkStateAsync`). Иначе близкие
  `Down→Degraded→Live` (напр. быстрый recover) обрабатывались конкурентно, `previous`-состояние
  считалось неверно (`recovering=false`) и `connection.recovered` не публиковался. Теперь смены
  связи обрабатываются строго по порядку — цикл `lost→recovered` надёжен (в т.ч. при flapping реала).

### Отображение и бейдж

- В буфере **обе строки**; подсветку/бейдж ведёт **последний статус на `correlationId`**.
- Шина держит `statusByCorrelationId`; строки без `correlationId` — сами себе группа.
- **`unread`-счётчик дедупит по `correlationId`**: считаем группы, у которых последний статус ∈
  `{active, underway}`, severity — alert (`error`/`critical`), и не прочитано. Перекрытые (не
  последние) строки группы приглушаются в UI.
- **Re-open (`→ active`) сбрасывает read** у новой строки → инцидент снова «загорается» (пере-алерт).

### Транспорт и конкурентность

- Переход едет как обычное `notification`-событие (`correlationId` + новый `status`); получатель
  делает upsert по `correlationId`. **Новый WS-тип не нужен** — hub остаётся тонким.
- **Фронт:** один поток (event loop) — локи не нужны, `resolve` атомарен.
- **Бэк (in-memory):** цикл load-check-transition-save под существующим `lock(_gate)` в
  `NotificationHub` — дешёвый пессимистик, оптимистик-версии не нужны.
- **Оптимистик-lock (`version`/`xmin`) понадобится только** когда состояние инцидентов уедет в БД
  (межпроцессно) — постоянный аудит-лог, отдельная будущая фаза (out of scope thin).

## MFE: механизм встраивания

| Вариант | Суть | Вердикт |
| ------- | ---- | ------- |
| **Shared-пакет + шина у хоста** | `packages/notification-center`, хост монтирует док | **v1 (сделано ядро)** |
| Module Federation | remote поверх того же пакета | позже |
| Web Component | custom element | не выбран |

## Backend: шина + история (ещё не сделано)

- `NotificationHub` (Host): in-memory ring-buffer, `Publish`, `GetRecent`.
- WS тип `notification` + REST `GET /api/notifications`.
- Источники: recording/connection/coverage + `ILogger` Warning+ → system; connector → external.
- Скраб секретов перед публикацией.

## Встраивание в OHS web

1. ~~`file:` зависимость~~ — `web/package.json` → `@scinverse/notification-center`.
2. ~~Singleton bus~~ — `web/src/core/notifications.ts` (`notificationBus`, `notificationDockOpen$`).
3. ~~Монтирование~~ — `NotificationCenterHost` в `App`; колокольчик в `IconSidebar` toggle дока (не секция).
4. ~~Время~~ — `createOffsetFormatTs(displayTz.offsetMin)`.
5. Адаптеры: user-действия `OhsStore`, WS/API — когда 11.2 готов.
6. Seed для проверки: Info `"Hello! I'm notification center)"`.

## Открытые вопросы

- Куда селить кнопку дока в OHS layout (низ экрана всегда vs пункт рейла) — при подключении.
- ULID vs текущий лёгкий id — достаточно для v1; сортировка по `ts`.
- Порог `ILogger` и белый/чёрный список категорий.
