# NC Dock Settings — опции отображения

Связано: [apply.md](apply.md) (I2), [to-threads.md](to-threads.md), пакет
`@scinverse/notification-center` (`dockSettings.ts`, `NotificationDock`).

Персист: хост (OHS — `notificationDockStorage` / localStorage); позже phase 10 `user_settings`.
Настройки **не** меняют продюсер и **не** режут аудит в БД.

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

### Ортогонально

Будущий «плоский режим без Thread» — отдельная галка; не смешивать с этой.

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
