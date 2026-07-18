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
| 11.6 | Встраивание в OHS web + персистенция состояния | PARTIAL | док + колокольчик + seed; персистенция/адаптеры WS — позже |
| 11.7 | Тесты | PARTIAL | vitest пакета 27 + OHS web 88; backend оркестратор — unit 115 (NotificationHubTests) |

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

## Итог

_(заполняется по завершении фазы)_
