# Phase 7i — apply: полуавтомат записи (Auto + Supervisor)

**Статус:** IN PROGRESS. Урезанный MVP относительно [plan.md](plan.md): без диалога политик,
без weekdays/warmup/US-tz. Политика = switcher **Auto** рядом со Старт/Стоп.

## UX (зафиксировано)

```
[Auto switcher][Старт / Стоп]
```

| Auto | Вид (`StatusSwitch` / те же фазы, что у связи) | Смысл |
|------|-----------------------------------------------|--------|
| off | `off` — серый | не контролирует |
| on, **реально пишет** | `active` — голубой | пишет (темп сделок/сессия не важны) |
| on, связи нет | `connecting` — жёлтый middle | «жду связи» |
| on, связь есть, в сессии, ещё не стартовал | `connecting` — жёлтый middle | вот-вот стартует (транзиент) |
| on, связь есть, вне сессии | `waiting` — зелёный | «всё ок, включу по расписанию» |

**Важно:** голубой (`active`) определяется **фактом записи** (`recordings$`), а не фронтовой оценкой
сессии. Ось `sessions$` может показывать прошлый день (D/W-скелет) — если завязать цвет на неё,
тумблер зеленеет во время активной записи. Старт по сессии решает **бэкенд-Supervisor** по календарю
FORTS; фронт лишь отражает результат. См. `autoPhase()` в `RecordingAutoToggle.tsx`.

Правила override:

1. Ручной **Стоп** → запись off + **Auto off** (автомат не спорит).
2. Старт всегда можно нажать; Стоп снимает и запись, и Auto.
3. **Auto серии** = как Старт серии на все страйки; Стоп любого → у него запись+Auto off,
   у остальных серии — **только Auto off** (запись не трогаем).

Сессия = MOEX FORTS (`IMarketCalendar` / engine `futures`), как гейт `LivenessProbe`.

## Backend

### V012 `recording_schedule`

```sql
instrument_id BIGINT PK → instrument
connection_id BIGINT → connector_connection
auto_enabled  BOOLEAN NOT NULL DEFAULT false
updated_at    TIMESTAMPTZ
```

Храним только `auto_enabled` + `connection_id` (провайдер для авто-старта). Полный `mode/weekdays/window`
из plan — later.

### `RecordingSupervisor`

- Тик ~30 с (+ nudge после PUT schedule).
- Для каждого `auto_enabled`:
  - **в сессии + связь живая:** `StartAsync` (идемпотентно).
  - **в сессии, связи нет:** ничего (жёлтый «жду связи» на фронте) — **Supervisor НЕ поднимает связь сам**.
  - **вне сессии:** `StopAsync` (Auto **не** снимаем).
- Ручной `DELETE /recordings/{id}` → `StopAsync` + `auto_enabled=false` + WS.

> **Почему без авто-connect:** TRANSAQ-коннектор процесс-глобален (одно соединение на процесс);
> фоновый `ConnectAsync` из Supervisor рассинхронит DLL и `ConnectionManager` (симптом:
> «Соединение уже установлено» при ручном connect). Связь поднимает пользователь тумблером
> провайдера; авто-connect/warmup — follow-up, если понадобится.

### API / WS

- `GET /api/recording/schedule`
- `PUT /api/recording/schedule` — batch upsert `{ instrumentId, connectionId, autoEnabled }[]`
- WS `recordingScheduleChanged` (опционально полный снимок / дельты)

## Frontend

- Вынести визуал `ConnectionToggle` в общий `StatusSwitch` (фазы/CSS).
- `RecordingAutoToggle` — тонкая обёртка: click on/off Auto, phase из store.
- `InstrumentPicker`: Auto слева от Старт/Стоп (инструмент + серия).
- `OhsStore`: `recordingSchedule$`, `setAuto`, `setSeriesAuto`, `stopRecording` чистит Auto серии.

## Индикатор подключения (осознанно оставлен как есть)

Тумблер **подключения** провайдера (`ConnectionToggle`, шапка): голубой (`active`) = идёт поток
данных, зелёный (`waiting`) = связь есть, потока нет.

Поток «active» ведётся от **реальных сделок** (`ConnectorSession.onData` → `ConnectionManager.ReportActivity`,
idle-монитор возвращает `active → waiting` после 5 c тишины). У TRANSAQ сделки приходят **только по
подписанным инструментам**, а подписка возникает **лишь при старте записи** (`<command id="subscribe">
<alltrades>`). Поэтому **без записи связь остаётся зелёной**, даже когда на рынке идут торги — коннектор
физически не получает ни одной сделки.

**Решение (обсуждено, оставляем как есть):** это корректная и честная семантика — голубой отражает
реальный поток, который мы получаем, а не «на рынке что-то происходит». Делать голубой без записи
(фоновая подписка-пинг / всегда-подписка с записью) **не будем** — это либо ломает смысл «намерения»
(7h: пишем только то, что вооружено), либо требует разделять «запись» и «пинг» в pump. Если позже
понадобится «рыночный пульс» без записи — отдельный follow-up (варианты: фоновая alltrades-подписка
видимых инструментов без персиста; либо эвристика «связь жива + идёт сессия FORTS»).

## Вне этого apply

Warmup, US-tz, кастомные окна, user-scope, диалог «Управление записью» — follow-up / полный plan.
- **«Рыночный пульс» подключения без записи** — см. раздел выше (осознанно отложено).
