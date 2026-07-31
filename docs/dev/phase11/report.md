# Phase 11. Отчёт о выполнении

Актуальный статус фазы 11. Обновляется по мере выполнения задач из [plan.md](plan.md).

**Текущий статус:** Thread **DONE**; **11.13a–f DONE**; **I2 RESOLVED**; **crash-dispatch D1–D8 DONE**.
[issue.md](issue.md) I2 · [incident-journal.md](incident-journal.md) §7 ·
[crash-dispatch.md](crash-dispatch.md).
**Обновлено:** 2026-07-30.

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
| 11.7 | Тесты | DONE | пакет (bus/Thread/filters/marks/tail); web hydrate; Hub+CloseBreak/Adopt unit; ApiTests connect/drop/abandoned_manual; GET — `limit` (фильтры на клиенте); `ILogger`-sink — с фичей |
| 11.8 | Объектная модель Thread (TS): Single / Entry / Thread / Incident / Group | DONE | `types.ts` + guards / `readThreadKindHint` |
| 11.9 | Проекция `events → items` в шине + тесты | DONE | `projectThreads` + `items$` / `events$` |
| 11.10 | UI NC: контейнеры, expand Thread, фильтры статуса нити + Выбор | DONE | `ThreadBlock`, `filterItems`; ★/⊘ per-Entry + [nc-marks.md](nc-marks.md) |
| 11.11 | Backend `threadKindHint` / `closeOutcome` в колонке `data` | DONE | Hub enrich + ConnectionManager + client crash; таблицы не меняли |
| 11.12 | Регрессия Thread (7j break/crash + hydrate V025) | DONE | `threadRegression.test.ts` + web `notifications.thread.test.ts` |
| 11.13 | Журнал инцидентов (`incident` в **OHS**) | **DONE** (a–f) | [incident-journal.md](incident-journal.md) §12 |
| Crash | Host outage: T Group + C fan-out (D1–D8) | **DONE** | [crash-dispatch.md](crash-dispatch.md); `47fb58e`…`62453e0` + D6+LS `ef6805b` |

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
| 2026-07-27 | Thread upgrade 11.8–11.12: типы Single/Entry/Thread; проекция `items$`; UI контейнеры + фильтры threadStatus/Выбор; hints в `data` jsonb (без миграций); регрессия break/crash + hydrate | NC vitest + web vitest + Host unit — зелёные |
| 2026-07-28 | Dock Settings: `collapsePhaseTicks` / `groupIntoThreads` ([dock-settings.md](dock-settings.md)); маркеры ★/⊘ на каждом Entry, header any/all bulk; фильтр «Выбор» асимметричный (★ include / ⊘ exclude, spam wins); tip Отметить/Снять, В спам/Показывать; ⊘ красный | [nc-marks.md](nc-marks.md); NC vitest — зелёные |
| 2026-07-29 | 11.7: CloseBreak abandon schedule/manual + Adopt/Forget protocol (unit); ApiTest disconnect-while-down → `abandoned_manual`; dock tail/pause; чеклист 11.7 приведён к факту (без серверных GET-фильтров / без тестов несуществующего ILogger-sink) | unit + ApiTests + NC vitest |
| 2026-07-29 | Старт **11.13**: журнал; wiki Incident vs notify; [incident-journal.md](incident-journal.md); handoff `promt.md` §8 | docs |
| 2026-07-29 | **DESIGN AGREED (финал):** `link_liveness`+`incident` в OHS; atoms → NC (gate); план 11.13a–f | docs |
| 2026-07-29 | **11.13a:** `V028__incident_journal.sql`, `IIncidentStore`/`IncidentStore`, DI, 6 integration tests | код + tests |
| 2026-07-29 | **11.13b:** `JournalRegistrator` + wire Manager/Supervisor/connect; `TryGetOpenCorrelationId`; unit | код + tests; crash J8 open |
| 2026-07-29 | **11.13c:** `GET /api/incidents` (+ `/{corr}`, `/connections/{id}/incidents`), `IncidentDto.durationMs` | Contracts + ApiTest |
| 2026-07-29 | **11.13d:** Admin UI «Журнал инцидентов» (nav `messages`) + `OhsApi.getIncidents` | web + vitest |
| 2026-07-29 | **11.13e:** Connection←`incident` + Recording binary merge; legacy gaps fallback | web + vitest |
| 2026-07-29 | **11.13f:** POST resolve/backfill-open; UI «Закрыть»; J8 crash ingest; resolvedBy | код + ApiTest |
| 2026-07-29 | **I2 OPEN:** рассинхрон NC Thread ≠ `incident`; канон fan-out OHS→journal+NC (§7 journal) | [issue.md](issue.md) I2 |
| 2026-07-29 | **I2 step1:** `IncidentStep` + `IncidentFanOut` (+ DI, unit open→resolve/crash) | код; callers → step2 |
| 2026-07-29 | **I2 step2:** break open/recovering/handover/resolve/adopt → fan-out | Manager/Supervisor |
| 2026-07-29 | **I2 step3:** crash ingest + manual resolve + connect recovering → fan-out | OhsEndpoints |
| 2026-07-29 | **I2 RESOLVED:** регрессия parallel crash (unit+ApiTest); критерии приёмки | [issue.md](issue.md) I2 |
| 2026-07-30 | **Crash dispatch D1–D8 DONE:** `POST /recovery/outage` merge; emit T (`ohs.host.transport:`) + C (`ohs.backend.outage:…:c{id}`); journal только desired; клиент — local Single + LS pending + POST + optimistic ribbon; cutover с client-led crash journal | HostOutage unit 14 · Crash_ Api 3 · web 48 · NC bus 23; [crash-dispatch.md](crash-dispatch.md) |

## Итог

Лента NC v1 — **готова**. Журнал OHS **11.13a–f DONE**. **I2 fan-out — RESOLVED**.
**Crash dispatch (Host outage T+C) — DONE.** Вынос atoms/пакета в NC — **gate 11→12**.
Итог мультиклиент / journal / link / NC — [../incident-model-wrapup.md](../incident-model-wrapup.md)
(2026-07-31). Хвост смежный 7j: **I12** ([../phase7j/plan.md](../phase7j/plan.md) §7j.22).
