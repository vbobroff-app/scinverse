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

export interface NotificationEvent {
  id: string;
  ts: string;                 // ISO-8601
  severity: NotificationSeverity;
  sourceType: NotificationSourceType;
  module: string;
  code: string;
  message: string;
  data?: Record<string, unknown>;
  correlationId?: string;
}
```

C# (бэк, `Scinverse.Ohs.Contracts`) — позже, вместе с 11.2: зеркальный `record NotificationEvent(...)`.

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

## Встраивание в OHS web (следующий шаг)

1. `file:` / workspace-зависимость на `@scinverse/notification-center`.
2. Singleton bus в `core/`, `formatTs` из `displayTz$`.
3. Монтирование `<NotificationDock />` в layout.
4. Адаптеры: user-действия `OhsStore`, WS/API when 11.2 готов.

## Открытые вопросы

- Куда селить кнопку дока в OHS layout (низ экрана всегда vs пункт рейла) — при подключении.
- ULID vs текущий лёгкий id — достаточно для v1; сортировка по `ts`.
- Порог `ILogger` и белый/чёрный список категорий.
