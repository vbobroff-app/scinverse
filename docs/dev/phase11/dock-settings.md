# NC Dock Settings — опции отображения

Связано: [apply.md](apply.md) (I2), [to-threads.md](to-threads.md),
[nc-marks.md](nc-marks.md) (★/⊘ / Удалённые и фильтр «Выбор»),
[incident-soft-delete.md](incident-soft-delete.md) (ось видимости журнала в ЦУ),
[layers.md §8](../../wiki-readme/layers.md) (фильтр дока «Слои» TL/CL/WL), пакет
`@scinverse/notification-center` (`dockSettings.ts`, `NotificationDock`).

Персист: хост (OHS — `notificationDockStorage` / localStorage); позже phase 10 `user_settings`.
Настройки **не** меняют продюсер и **не** режут аудит в БД.

Две галки секции **«Лента»** независимы.

---

## Объединять прогресс-тики (`collapsePhaseTicks`)

| | |
|---|---|
| **UI** | Settings → «Объединять прогресс-тики» |
| **Default** | **включено** (`true`) |
| **Слой** | клиентская шина (`NotificationBus`): raw-буфер полный → проекция в ленту |

### On (default)

Фазовые тики I2 схлопываются в одну строку на `(correlationId, code, status)`:

- `connection.recovering` / `reconnecting` (supervisor) / `connecting`
- `connection.connect_failed`
- `backend.unavailable.progress` / `*.progress`

Первый id фазы сохраняется, текст/ts обновляются последним тиком (unread не мигает на каждый тик).

### Off

В ленте видны **все** тики из raw-буфера (и из бэклога после hydrate). Переключение on↔off
пересобирает проекцию из raw **без** повторного GET — БД по-прежнему хранит полный журнал.

---

## Группировать (`groupIntoThreads`)

| | |
|---|---|
| **UI** | Settings → «Группировать» |
| **Default** | **включено** (`true`) |
| **Слой** | проекция ленты в `NotificationDock` (`items` / `projectThreads`) |

### On (default)

Как сейчас: контейнеры Single | Incident | Group (заголовки, expand стека Entry).
`correlationId` связывает события внутри контейнера; просмотр истории — по ссылке corr.

### Off

Плоский список: **каждое** уведомление ленты — Single, newest-first по `ts`.
Нет заголовков Incident/Group, нет стека. Corr в данных/ссылке остаётся для поиска и фильтра.

Фильтры: по **статусу атома** (`status`: active / underway / resolved). Плашка
«Статус нити» в меню фильтров скрыта (при off не применима).

---

## Уже существующие галки (кратко)

| Ключ | UI | Default |
|------|-----|---------|
| `showFilters` | Панель фильтров | on |
| `trackUnread` | Учёт непрочитанных | on |
| `showStatusLogo` | Логотип severity | on |
| `showType` | Метка Info/Warning/… | on |
| `sendToTray` | В трей | off |
| **`collapsePhaseTicks`** | **Объединять прогресс-тики** | **on** |
| **`groupIntoThreads`** | **Группировать** | **on** |
