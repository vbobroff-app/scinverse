# Phase 11. Отчёт о выполнении

Актуальный статус фазы 11. Обновляется по мере выполнения задач из [plan.md](plan.md).

**Текущий статус:** `IN PROGRESS`. **Обновлено:** 2026-07-14.

## Статус задач

| #    | Задача | Статус | Комментарий |
| ---- | ------ | ------ | ----------- |
| 11.1 | Контракт `NotificationEvent` (TS + C# DTO), таксономия severity/sourceType | PARTIAL | TS в пакете; C# DTO — с 11.2 |
| 11.2 | Backend: `NotificationHub` + WS `notification` + `GET /api/notifications` + `ILogger`-sink | TODO | |
| 11.3 | Пакет: `NotificationBus` (RxJS), хелперы `notify.*` | DONE | `packages/notification-center`; без OHS-адаптеров |
| 11.4 | UI: нижний док `NotificationDock` (tail, раскрытие, resize) | DONE | виртуализация — follow-up |
| 11.5 | Фильтры (уровень/тип/модуль/поиск) + бейдж непрочитанных | DONE | в доке пакета |
| 11.6 | Встраивание в OHS web + персистенция состояния | TODO | следующий шаг |
| 11.7 | Тесты | PARTIAL | vitest ядра/UI пакета зелёные; backend — позже |

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

## Итог

_(заполняется по завершении фазы)_
