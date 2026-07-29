# Phase 11. Центр уведомлений (сквозная лента событий, MFE)

Единый **центр уведомлений** — нижний док-панель со сквозной лентой всех логов и событий системы.
Встраивается во все модули фронта единообразно как **MFE-компонент** поверх общего потока сообщений.
Сквозная фаза (как phase 10): контракт событий общий для всех модулей и обоих контуров (.NET горячий,
Python холодный). Дизайн Stage 1 — в [../apply.md](../apply.md); детали реализации — в
[apply.md](apply.md); статус — в [report.md](report.md).

**Статус:** `IN PROGRESS`. **Stage:** 1 (сквозная). **Зависимости:** control-plane WS `/ws` (phase 6b) —
транспорт системных/внешних событий; необязательно — `user_settings` (phase 10) для персистенции
состояния панели/фильтров. Влияет на все модули фронта и на серверное логирование.

**Фокус сейчас:** **11.13** — журнал инцидентов: DESIGN AGREED → план
([incident-journal.md](incident-journal.md) §12). Таблица `incident` в **OHS** (рядом с
`link_liveness`); поток `notification` / пакет → NC MFE (gate 11→12). Thread 11.8–11.12 — **DONE**.

**Ядро UI/шины:** пакет [`packages/notification-center`](../../../packages/notification-center)
(`@scinverse/notification-center`) — без привязки к OHS.

**Upgrade объектной модели (Thread):** проблема — [issue.md](issue.md); проектирование —
[to-threads.md](to-threads.md); персист атомов — [persistence.md](persistence.md) (V025 DONE).
Опции дока (группировать / схлоп тиков) — [dock-settings.md](dock-settings.md);
маркеры ★/⊘ и фильтр «Выбор» — [nc-marks.md](nc-marks.md).
Журнал инцидентов (next) — [incident-journal.md](incident-journal.md);
продуктовое определение — [`docs/wiki-readme/incident.md`](../../wiki-readme/incident.md).

## Мотивация

Сейчас события живут разрозненно: WS-события (`recordingStarted`/`coverageExtended`/
`connectionStatusChanged`) обновляют точечный UI, ошибки API уходят в `console.error`, серверные
логи и логи коннектора не видны оператору. Нужна **единая наблюдаемая лента** для оператора:
что сделал пользователь, что произошло в системе и что пришло извне (коннектор/биржа) — с уровнями
важности, фильтрами и историей.

## Таксономия события (зафиксировано)

- **Уровень (severity):** `info` · `warning` · `critical` · `error`.
  - `info` — штатное событие (запись стартовала, покрытие расширено).
  - `warning` — деградация/повтор/восстановимое (реконнект, пустой ответ).
  - `error` — операция не удалась (ошибка API, разрыв коннектора).
  - `critical` — системная авария/потеря данных, требует немедленного внимания.
- **Тип (sourceType):** `user` · `system` · `external`.
  - `user` (User Actions) — действия оператора: старт/стоп записи, connect/disconnect, создание
    подключения, применение фильтров.
  - `system` — внутренние события приложения и OHS Host: жизненный цикл записи/покрытия, статусы
    подключений, ошибки/предупреждения серверного лога (`ILogger` уровня Warning+).
  - `external` — то, что пришло извне: коннектор TRANSAQ (server_status, ошибки DLL, дисконнекты),
    поставщик данных, MOEX ISS (новости/статусы), сетевые сбои прокси.

## Область (in scope)

- **11.1 Контракт события.** Единая модель `NotificationEvent` (id, ts, severity, sourceType,
  module, code, message, data?, correlationId?) — общий TS-тип (фронт) и C#-DTO (бэк), стабильные
  `code` для машинной фильтрации.
- **11.2 Backend: шина + история.** In-memory ring-buffer (последние N), broadcast в `/ws`
  (новый тип события `notification`), REST `GET /api/notifications` (бэклог при загрузке, фильтры
  `severity`/`sourceType`/`since`). Источники: обёртки над recording/connection/coverage +
  `ILogger`-провайдер (Warning+ → system), события коннектора → external.
- **11.3 MFE-ядро (framework-agnostic).** Пакет/модуль `notification-center`: синглтон-шина
  (RxJS `BehaviorSubject` ленты) с API `publish(event)`/`stream$`, буфер, дедуп, ограничение
  размера; агрегатор WS→шина и API-ошибок→шина. Шина — общий singleton (shared) для всех MFE.
- **11.4 UI: нижний док.** Сворачиваемая панель снизу (консоль-drawer), лайв-tail с авто-скроллом
  и паузой при ручном скролле, строка = время · иконка уровня · тег типа · тег модуля · сообщение;
  раскрытие строки → детали/JSON контекста.
- **11.5 Фильтры и бейджи.** Плашки-фильтры по уровню (Info/Warning/Critical/Error) и по типу
  (User/System/External), текстовый поиск, фильтр по модулю; бейдж непрочитанных (счётчик ошибок/
  критичных) на кнопке дока в статус-строке.
- **11.6 Встраивание.** Единообразное подключение во все модули: хост-модуль монтирует
  `<NotificationDock />` и публикует свои `user`-события через шину; чёткий publisher-API и хелперы
  (`notify.info/warn/error/critical`). Персистенция состояния панели (открыта/высота/фильтры) —
  локально, при наличии phase 10 — в `user_settings`.
- **11.7 Тесты.** Ядро: publish/stream, буфер/лимит, дедуп, hydrate DTO→шина (vitest). UI: рендер
  ленты, фильтрация, tail/пауза, бейдж. Backend: Hub + ring/`GET /api/notifications` (limit),
  CloseBreak abandon/recovered, Adopt/Forget. Фильтры severity/sourceType — на клиенте (не на GET).
  `ILogger`-sink → notification — вместе с фичей (пока out of scope).
- **11.8 Объектная модель Thread (контракт TS).** Типы `NotificationItem = Single | Thread`,
  `Entry`, специализации `Incident` / `Group`; поля `threadKind`, `threadStatus`, `closeOutcome`;
  инварианты T1/T2. Спека — [to-threads.md](to-threads.md); мотивация — [issue.md](issue.md).
- **11.9 Проекция в шине.** `events → items`: группировка по `correlationId`, вывод
  `threadStatus` / `threadKind`, orphan-политика, `items$` для UI при сохранении плоского
  `events$` (совместимость, I2-upsert атомов). Тесты проекции (vitest): recovered, abandon,
  orphan recovering, Single без corr.
- **11.10 UI NC: контейнеры.** Лента = Single + Thread header на одном уровне; header без
  severity-иконки, custom summary; expand/collapse стека Entry; subtle `[!]`/`[G]` сдвигает
  контент Entry. Фильтры: статус нити (active / recovering / resolved) + «Выбор»
  (★ Избранные include / ⊘ Скрыть спам exclude; см. [nc-marks.md](nc-marks.md)).
  Бейдж непрочитанных — по контейнерам (см. to-threads §4).
- **11.11 Backend hints + политика kind.** На Open писать `data.threadKindHint`
  (`incident`|`group` по горизонту расписания); на close — `data.closeOutcome`
  (`recovered`|`abandoned_schedule`|`abandoned_manual`). **Таблицы v1 не меняем:** колонка `data`
  покрывает UI/проекцию. Задел под журнал: тот же enum `incident|group` (не `single`) станет
  индексируемой колонкой `thread_kind` в производной `notification_thread` — см.
  [to-threads.md](to-threads.md) §6.3. Wire WS/REST атомов без ломки.
- **11.12 Регрессия + приёмка Thread.** Пакет + OHS web + backend: сценарии break/crash из
  phase 7j отображаются как Incident/Group; Group не продолжает Incident; плоский audit V025
  и hydrate не ломаются; tsc/vitest/`dotnet` зелёные.
- **11.13 Журнал инцидентов.** Таблица `incident` в **OHS Timescale**; writer + API + UI журнала
  в Admin; ribbon: liveness + incidents ← OHS. Лента atoms — as-is V025 / to-be NC
  ([gate 11→12](../plan.md)). Канон — [incident-journal.md](incident-journal.md).

## Вне области (out of scope)

- Менять схему OHS `notification` ради UI Thread — не нужно. Журнал — новая таблица `incident` в OHS
  (не ALTER V025). Перенос atoms в NC — gate 11→12.
- Пуш-уведомления (email/telegram/desktop) и правила-алерты — позже.
- Тонкая маршрутизация по ролям (кто какие события видит) — грубо; тонко — вместе с phase 10.
- Полноценный рантайм Module Federation с раздельными деплоями — задел в контракте / gate 11→12;
  журнал можно проектировать до полного выноса MFE.
- Серверное хранение меток ★/⊘ — v1 только клиент / `user_settings`.
- `ILogger`-sink → notification — отдельная фича.

> Персист плоского аудита (`notification`, V025, retention 90d) — **сделан** ([persistence.md](persistence.md));
> прежний out-of-scope «только ring-buffer» устарел.

## Критерии приёмки

1. Действия оператора (старт/стоп, connect/disconnect, создание подключения) появляются в ленте как
   `user`-события в реальном времени.
2. Серверные и внешние события (recording/coverage/connection + логи коннектора/Host уровня Warning+)
   приходят в ленту как `system`/`external` через `/ws`; при загрузке подтягивается бэклог из
   `GET /api/notifications`.
3. Фильтры по уровню и типу работают совместно (И), есть текстовый поиск и фильтр по модулю; бейдж
   непрочитанных отражает число ошибок/критичных.
4. Панель встраивается в любой модуль единообразно (один компонент + общая шина-singleton); лента
   сквозная (события из разных модулей в одном потоке).
5. `dotnet build`/тесты и `tsc`/`vitest` зелёные; секреты/креды в ленту и логи не попадают.
6. **Thread:** лента показывает контейнеры Single/Thread; Incident vs Group по политике горизонта;
   фильтры статуса нити и «Выбор»; стек Entry раскрывается без смены wire-аудита.

## Порядок

**База (DONE):** 11.1 → 11.3 → 11.4 → 11.5 → 11.2 → 11.6 → 11.7 + persistence V025.

**Upgrade модели:** 11.8 → 11.9 → 11.10 → 11.11 → 11.12 — **DONE** (2026-07-27).

**Далее:** **11.13a** миграция OHS `incident` + store —
[incident-journal.md](incident-journal.md) §12 (handoff [`docs/promt.md`](../../promt.md) §8).

**Продюсер break (не UI):** sync Host (`_incidentSince` ↔ Hub) — **I10/I11 код готов**
([../phase7j/issue.md](../phase7j/issue.md)); живая приёмка / хвосты 7j.15–16 — не блокер 11.13.

Детали — в [apply.md](apply.md), Thread — [to-threads.md](to-threads.md), журнал —
[incident-journal.md](incident-journal.md), статус — в [report.md](report.md).