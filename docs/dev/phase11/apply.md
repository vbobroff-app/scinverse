# Phase 11. Особенности реализации

Конкретные решения фазы 11. Обзор — в [plan.md](plan.md), статус — в [report.md](report.md).
Заполняется по ходу реализации; ниже — зафиксированные проектные заметки.

## Контракт события

TypeScript (фронт, `web/src/core/notifications/types.ts`):

```ts
export type NotificationSeverity = 'info' | 'warning' | 'critical' | 'error';
export type NotificationSourceType = 'user' | 'system' | 'external';

export interface NotificationEvent {
  id: string;                 // uuid/ulid, генерит источник
  ts: string;                 // ISO-8601 (МСК +03:00 для доменных, UTC для системных)
  severity: NotificationSeverity;
  sourceType: NotificationSourceType;
  module: string;             // 'ohs.recording' | 'ohs.connection' | 'connector.transaq' | 'moex.iss' | …
  code: string;               // стабильный машинный код: 'recording.started', 'connection.error', …
  message: string;            // человекочитаемо (RU), без секретов
  data?: Record<string, unknown>; // контекст (instrumentId, connectionId, tradeCount, …)
  correlationId?: string;     // связывание цепочек (напр. один connect-флоу)
}
```

C# (бэк, `Scinverse.Ohs.Contracts`): зеркальный `record NotificationEvent(string Id, DateTimeOffset Ts,
string Severity, string SourceType, string Module, string Code, string Message,
IReadOnlyDictionary<string, object?>? Data, string? CorrelationId)`.

## MFE: механизм встраивания

| Вариант | Суть | Плюсы | Минусы | Вердикт |
| ------- | ---- | ----- | ------ | ------- |
| **Shared-пакет + singleton-шина** | ин-репо пакет, единый `NotificationBus` (RxJS) как shared-singleton | просто, без рантайм-оркестрации; работает уже сейчас (одно SPA) | не изолирует раздельные деплои | **v1 (выбран)** |
| Module Federation (Vite `@originjs/vite-plugin-federation`) | runtime-подгрузка remote-модулей, `shared` singleton шины | настоящий MFE для раздельных сборок | лишняя сложность пока модуль один | задел (контракт готов) |
| Web Component (`custom element`) + CustomEvent-шина | док как `<scinverse-notifications>`, события через DOM | фреймворк-независимо | слабая типизация, дубль стилей | не выбран |

Решение: v1 — **shared-пакет + singleton-шина**; контракт события и API шины проектируем так, чтобы
перенос на Module Federation не менял вызовов (`bus.publish` / `bus.stream$` стабильны). Шина живёт в
`core/` (framework-agnostic), UI-док — тонкий React-слой поверх (как остальной фронт: `core` + `ui`).

## Ядро (framework-agnostic)

- `NotificationBus` (`core/notifications/NotificationBus.ts`): `BehaviorSubject<NotificationEvent[]>`
  с ring-buffer (лимит ~1000), `publish(evt)`, `stream$`, `clear()`, дедуп по `id`, счётчик
  непрочитанных по уровню. Экспортируется как singleton (при MFE — через `shared`/глобальный реестр).
- Хелперы `notify.info|warn|error|critical(module, code, message, data?)` — сахар над `publish`
  (проставляют `sourceType`, `ts`, `id`).
- Агрегаторы: `wsToNotifications(liveEvent)` — маппинг `LiveEvent` (recording/coverage/connection) в
  `system`-события; интерцептор ошибок `rxjs/ajax` → `error`/`system`. Действия `OhsStore`
  (start/stop/connect/create) публикуют `user`-события.

## Backend: шина + история

- `NotificationHub` (Host): `Channel`/событие + in-memory ring-buffer (`ConcurrentQueue`, лимит N),
  `Publish(NotificationEvent)`, `GetRecent(filter)`.
- Broadcast: расширить `WebSocketBroadcaster` — новый WS-тип `notification` (дискриминатор `type`),
  во фронтовом `LiveEvent`-union добавить ветку `{ type: 'notification'; event: NotificationEvent }`.
- REST: `GET /api/notifications?severity=&sourceType=&since=&limit=` → бэклог из ring-buffer.
- Источники на бэке:
  - **system:** обёртки в `RecordingManager`/`ConnectionManager`/`CoverageTracker` публикуют события
    рядом с существующими WS-событиями; `ILoggerProvider`-адаптер форвардит записи уровня
    `Warning`+ в `NotificationHub` (`module` = категория логгера).
  - **external:** `ConnectorSession`/`TransaqConnector` публикуют server_status/ошибки/дисконнекты
    как `external`; MOEX ISS-клиент (phase 7c) — новости/статусы (переиспользуем «ленту событий»,
    которая уже упомянута в [phase7c/apply.md](../phase7c/apply.md)).
- Безопасность: перед публикацией — скраб секретов (login/password/токены не попадают в `message`/
  `data`).

## UI: нижний док

- `NotificationDock` (`ui/components/NotificationDock`): фиксированный низ, сворачивание/ресайз по
  высоте, лайв-tail с авто-скроллом (пауза при ручном скролле вверх), виртуализация длинной ленты.
- Строка: `time · severity-icon · [type] · [module] · message`, цвет по уровню
  (`--color-*`: info=muted/accent, warning, error; critical=акцентно-красный/пульс). Клик → раскрытие
  `data`/деталей.
- Фильтры — тот же chips-паттерн, что и в каталоге (см. `FilterChips`): плашки уровня и типа + поиск +
  фильтр модуля. Бейдж непрочитанных (ошибки/критичные) на тумблере дока в статус-строке.
- Персистенция: открыт/высота/активные фильтры — `localStorage` в v1; при phase 10 — в `user_settings`.

## Открытые вопросы

- Куда селить кнопку открытия дока: статус-бар снизу vs иконка в шапке — вероятно постоянная
  статус-строка снизу со счётчиком.
- Нужен ли уровень `debug`/trace для разработчика (за флагом) — решить при старте.
- Единый ULID-генератор для `id` на фронте и бэке (сортируемость по времени) — выбрать библиотеку.
- Порог `ILogger` (Warning+) и белый/чёрный список категорий, чтобы не зашумлять ленту.
