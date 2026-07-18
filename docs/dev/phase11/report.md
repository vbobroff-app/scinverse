# Phase 11. Отчёт о выполнении

Актуальный статус фазы 11. Обновляется по мере выполнения задач из [plan.md](plan.md).

**Текущий статус:** `IN PROGRESS`. **Обновлено:** 2026-07-18.

## Статус задач

| #    | Задача | Статус | Комментарий |
| ---- | ------ | ------ | ----------- |
| 11.1 | Контракт `NotificationEvent` (TS + C# DTO), таксономия severity/sourceType | DONE | TS + `status`/`correlationId`; C# `NotificationDto` (+status/correlationId) |
| 11.1a | Две оси: read-state (шина) + lifecycle `status` (active/underway/resolved) + переходы | DONE | шина: upsert/I2/бейдж по последнему статусу; бэк-оркестратор open/progress/resolve |
| 11.2 | Backend: `NotificationHub` (оркестратор) + WS `notification` + `GET /api/notifications` + первый продюсер | DONE | продюсер connection.lost/reconnecting/recovered (ConnectionManager + Supervisor); `ILogger`-sink — позже |
| 11.3 | Пакет: `NotificationBus` (RxJS), хелперы `notify.*` | DONE | `packages/notification-center`; без OHS-адаптеров |
| 11.4 | UI: нижний док `NotificationDock` (tail, раскрытие, resize) | DONE | виртуализация — follow-up |
| 11.5 | Фильтры (уровень/тип/модуль/поиск) + бейдж непрочитанных | DONE | в доке пакета |
| 11.6 | Встраивание в OHS web + персистенция состояния | DONE | док + колокольчик; WS `notification`→шина; бэклог `GET /api/notifications` на старте; демо-seed только в dev |
| 11.7 | Тесты | PARTIAL | vitest пакета 29 + OHS web 89; backend unit 115; ApiTests: connect/disconnect→user-события, drop→инцидент lost/recovered |

## Решение

- Независимый пакет `@scinverse/notification-center` (не MFE): контракт + шина + док.
- Время: ISO в событии; отображение через проп `formatTs` (стандарт хоста).
- Источник сообщений сменный: хост кормит bus (`publish` / `publishMany`).
- MFE-обёртка — позже, поверх того же пакета.

## Лог выполнения

| Дата | Действие | Результат |
| ---- | -------- | --------- |
| 2026-07-10 | Заведена фаза 11: план/apply/отчёт; зафиксирована таксономия и MFE-подход | документы готовы |
| 2026-07-14 | Пакет `packages/notification-center`: bus, notify, dock, filters, formatTs; тесты | 11 passed; OHS не подключён |
| 2026-07-14 | OHS web: колокольчик → док, `displayTz` → formatTs, seed Info hello | док открывается из рейла |
| 2026-07-18 | Зафиксирован дизайн осей: read-state + lifecycle `status`, машина переходов (open/progress/resolve), инварианты I1/I2, upsert по `correlationId` | apply.md §Оси состояния |
| 2026-07-18 | 11.2: реализованы контракт `status`/`correlationId` (TS+C#), шина (upsert/I2/бейдж по последнему статусу, `statusOf`), фильтр `statuses`, бэк-оркестратор `Open/Progress/Resolve` под lock, первый продюсер `connection.lost/reconnecting/recovered`, seed переведён на ось `status` | пакет 27, OHS web tsc+88, backend unit 115 — зелёные |
| 2026-07-18 | UI оси B (цветовая модель): read/unread → цвет border; lifecycle → фон-маска (открытый warning=жёлтый, error/critical=красный, resolved=зелёный), без pill/иконок; underway-продюсер поднят до `warning` (эскалация красный→жёлтый→зелёный); чип фильтра «Статус» в `DockFilters` (+persist); ретайр `interaction:'resolving'` | пакет tsc+29, OHS web tsc+88 — зелёные |
| 2026-07-18 | Группировка/поиск инцидентов: `correlationId = subject:uid` (per-occurrence) — продюсер даёт subject (`connection:{id}:link`), хаб на `Open` генерит uid, `Progress`/`Resolve` переиспользуют; `LinkIncidentId`→`LinkIncidentSubject`; поиск по `correlationId` в `filterEvents`; клик по `corr` в строке → фильтр по инциденту (`NotificationRow`/`NotificationDock`) | backend unit 115, пакет+OHS web — зелёные |
| 2026-07-18 | 11.6 встраивание завершено: бэклог `GET /api/notifications` подтягивается в шину на старте (`OhsStore.refreshNotifications`→`hydrateServerBacklog`, дедуп по id); демо-seed переведён под `import.meta.env.DEV` (в prod лента = реальный бэклог + WS); WS `notification`→`publishServerNotification` уже был | OHS web tsc + vitest 89 — зелёные |
| 2026-07-18 | Крит. #1 (действия оператора): эндпоинты connect/disconnect шлют `user`-события (`connection.connect`/`connection.disconnect`, info; connect fail → error); ручной disconnect дополнительно `Resolve` открытого инцидента связи (no-op, если инцидента нет — чтобы не «висел» красным); гард в `ConnectionManager.HandleLinkStateAsync` (событие связи без активной сессии = штатный teardown, не инцидент) убирает ложный `connection.lost` при добровольном off | backend build + unit 115 — зелёные |
| 2026-07-18 | Верификация connection end-to-end (ApiTests, Testcontainers): `Connect_and_disconnect_emit_user_notifications` (user-события) и `DebugDrop_emits_link_incident_lifecycle_notifications` (обрыв→`connection.lost` active/error, восстановление→`connection.recovered` resolved, correlationId=`subject:uid`) | 2 интеграционных теста — зелёные |
| 2026-07-18 | Фаза connect как мини-ЖЦ (QUIK-опыт): `Publish` (+iface) получил опц. `status`/`correlationId`; эндпоинт `/connect` шлёт `connection.connecting` (warning/underway) мгновенно → `connection.connect` (ok/resolved) / `connection.connect.failed` (error) одной группой `connection:{id}:connect:{uid}` — жёлтый→зелёный/красный; в сообщение успеха дописано «Предыдущее подключение — … МСК; пред. сеанс — …» из нового `ILinkLivenessStore.GetLastAsync` (+ `data.lastConnectedAt`/`lastCloseReason`); ApiTest обновлён (connecting+connect+общий corr) | backend unit 115 + ApiTests 3 — зелёные; проверено вживую (synthetic) |
| 2026-07-18 | Фикс гонки `recovered`: `ConnectorSession` await-ит `onLinkState` в pump-цикле (было fire-and-forget `_ = HandleLinkStateAsync`) — близкие `Down→Degraded→Live` обрабатывались конкурентно, `previous` считался неверно и `recovered` не публиковался; теперь смены связи строго последовательны | цикл lost→recovered надёжен (unit 115 + ApiTests 3 зелёные, подтверждено live) |
| 2026-07-18 | Разделение «команда/исполнение» в connect: ведущее `connection.connect` (info, **user**) «по команде оператора» + исполнение системой `connection.connecting`(warning/underway)→`connection.connected`(ok/resolved)/`connection.connect_failed`(error), все **system**; коды успеха/ошибки согласованы с авто-путём `ConnectionSupervisor`; ApiTest обновлён | unit 115 + ApiTests 3 зелёные; live: 4-строчный цикл user→system→system→user подтверждён |

## Итог

_(заполняется по завершении фазы)_
