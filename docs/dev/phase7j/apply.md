# Phase 7j — apply: расписание соединения (Auto + Supervisor)

**Статус:** IN PROGRESS. Детали MVP относительно [plan.md](plan.md).

## UX (зафиксировано)

Два switcher’а (как запись: Старт/Стоп + Auto):

```text
ProviderCard head:   [Finam …]                    [Тумблер связь]   ← не меняем
Полоса Связь:        [Связь · Finam]  [Auto]  [Расписание]  | лента ConnectionRibbon
```

| Управление | Поведение |
|------------|-----------|
| Тумблер связи (верхний) | Ручной connect/disconnect |
| Auto on | Supervisor включает/выключает верхний тумблер по окну |
| Ручной off верхнего | связь off + **Auto off** |
| Ручной on верхнего при Auto off | connect без расписания |
| Auto без утверждённого окна | **нельзя** → открыть popover «Расписание» |

Фазы Auto — `StatusSwitch` (как `RecordingAutoToggle`): off / waiting (вооружён вне окна) /
connecting / active (связь up) / error (после ×5 fail).

### Popover «Расписание»

Черновик до **Утвердить**; в БД только после confirm.

```text
00:00 --------[open]================[close]--------→  (+ хвост после 24:00 если close < open)

○ Настроить вручную
○ MOEX срочный  ± [N] ч   [Применить]   → engine = futures (ISS/FORTS)
○ MOEX фондовый ± [N] ч   [Применить]
○ MOEX валютный ± [N] ч   [Применить]

change_note: [опц.]
[Утвердить] → confirm → PUT (SCD-2 новая версия окна)
```

Просмотр: текущее окно + история версий (`effective_from`, окно, `change_source`, note).

Дефолт N = 1. Пресет читает open/close из `market_schedule` / календарь и пишет в черновик
`open−N` / `close+N` (через полночь допустимо).

## Backend

### V021 `connection_schedule`

```sql
connection_schedule (
  schedule_id       BIGSERIAL PK,
  connection_id     BIGINT NOT NULL → connector_connection,
  mode              TEXT NOT NULL,   -- manual | scheduled
  window_start      TIME NOT NULL,
  window_end        TIME NOT NULL,   -- может быть < start (через полночь)
  engine            TEXT NOT NULL,   -- ведущий календарь дней: futures | stock | currency
  tz                TEXT NOT NULL DEFAULT 'Europe/Moscow',
  effective_from    TIMESTAMPTZ NOT NULL,
  effective_to      TIMESTAMPTZ NULL, -- NULL = текущая версия окна
  change_source     TEXT NOT NULL,   -- ui | api | preset_moex_* | seed
  change_note       TEXT NULL
);
-- UNIQUE (connection_id) WHERE effective_to IS NULL
```

- Смена **окна** / engine / tz / note → `UPDATE` старой (`effective_to = now`) + `INSERT`.
- Смена **mode** (Auto) → `UPDATE` текущей строки, **без** новой версии.
- `changed_at` нет: момент = `effective_from` / `effective_to`.
- Календарь дней: только `engine` строки, **без join** рынков. FORTS обычно шире — выходных почти нет.

### `ConnectionSupervisor`

Рядом с `RecordingSupervisor`; тик = `OhsOptions.LivenessProbeSeconds` (**15 с**), nudge после PUT.

| Таймер | Смысл |
|--------|--------|
| Tick 15 с | Сверка desired↔actual + живость (не интервал retry) |
| Nudge | Сразу после PUT Auto/окна |
| Retry ×5 | Пауза ~5–10 с между `ConnectAsync`; после fail — notify; не tight-loop |

**Desired при `mode=scheduled`:**

- non-trading (`IMarketCalendar` / `engine`) ∨ вне окна → disconnect;
- торговый день ∧ в окне ∧ не connected → Connect (до 5) + notify;
- в окне ∧ connected → живость (см. ниже).

**Override:** ручной `DisconnectAsync` из UI → Auto off (`mode=manual` UPDATE) + disconnect.
Ручной Connect при `manual` — Supervisor не вмешивается.

Single-flight connect только через `ConnectionManager` (не дублировать native TRANSAQ connect).

### Живость и анти-DDoS Finam

Переиспользовать логику 7h (`LivenessProbe` / `ProbeConnectionAsync`):

1. Push `server_status` → `IsConnected` / `HandleLinkStateAsync` (мгновенно).
2. Сделка за ≤15 с → probe не нужен.
3. Активный `get_servtime_difference` — **только** в биржевой сессии площадки при тишине.
4. Плечи окна (±N до/после сессии): держим линк, **probe нет** (тишина законна).
5. Выходные / вне окна: не connect, не probe.

### API

- `GET /api/connections/{id}/schedule` — текущая строка (или 404, если ещё не создавали).
- `PUT /api/connections/{id}/schedule`:
  - тело только с `mode` / `autoEnabled` → UPDATE текущей;
  - тело с окном (+ note/source) → SCD-2 close+insert.
- `GET /api/connections/{id}/schedule/history` — версии окон.
- Nudge Supervisor после успешного PUT.
- WS: существующий `connectionStateChanged` + `notification`.

### Notify (тонкий срез 11.2)

- `INotificationSink`: ring-buffer + broadcast WS `notification` + `GET /api/notifications`.
- Коды: `connection.connecting`, `connection.connected`, `connection.connect_failed`,
  `connection.lost`, `connection.reconnecting`, `connection.recovered`,
  `connection.schedule_disconnect`.
- Фронт: адаптер WS → `@scinverse/notification-center` bus.

**Перспектива:** полный 11.2 (`ILogger`-sink, user-actions, фильтры) — без смены контракта события.

### Креды

MVP: как сейчас (`appsettings.Local` / in-memory). Персист для ночного Auto — отдельно.

## Frontend

- Полоса `InstrumentPicker` connLane: `[Auto][Расписание]` рядом с `Связь · {name}`.
- `ConnectionAutoToggle` — обёртка `StatusSwitch`; `setConnectionAuto` / чтение schedule из store.
- `ConnectionSchedulePopover` — ось, пресеты, history, Утвердить + confirm.
- `OhsStore`: `connectionSchedule$`, команды API; при ручном disconnect — Auto off (как запись).
- Тумблер в `ProviderCard` — без переноса.

## Тесты

- Unit: окно через полночь; in-window / out-of-window.
- Store/API: SCD-2 версия окна; UPDATE mode без новой версии; unique current.
- Supervisor на synthetic: Auto on → connect в окне; вне окна → disconnect; ×5 fail → notify.
- `tsc --noEmit` + vitest + `dotnet test`.

## Порядок внедрения

1. Docs (эта папка) + индексы roadmap/promt.
2. V021 + store + API.
3. `ConnectionSupervisor` + анти-DDoS гейты + retry.
4. Notify sink + коды.
5. UI Auto + popover.
6. Тесты / приёмка на synthetic → Finam.
