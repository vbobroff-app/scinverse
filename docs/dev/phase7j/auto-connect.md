# Phase 7j.18 — Auto-connect NC & incident hardening

Статус: **КОД ГОТОВ** (реализовано; `dotnet build` solution 0/0; живая приёмка по §7 — за пользователем).

> **Поправка 7j.19/I4:** `connected` больше НЕ несёт QUIK-хвост в заголовке — заголовок чистый
> («связь установлена.»), а детали пред. подключения/сеанса ушли в expanded `data.lines`
> (`PreviousConnectionLines`). Плановое отключение теперь закрывает `link_liveness` причиной
> `Scheduled` (I1), инцидент связи закрывается идемпотентно с длительностью перерыва (I2+I3).
> Диагностика и решения — [issue.md](issue.md).

Связано: [report.md](report.md), [issue.md](issue.md), [error-handling.md](error-handling.md), [notify-composer.md](notify-composer.md), [v2-exceptions.md](v2-exceptions.md).

---

## 1. Контекст

7j.17 привёл к единому стандарту NC **редактирование расписания** (имя-первично, severity по смыслу
перехода, user/system-дисциплина, correlationId, попап без оптимизма). Но **рантайм** — авто-подключение
по расписанию (`ConnectionSupervisor`) и инциденты связи (`ConnectionManager`) — писался раньше и до
этого стандарта не дотянут.

Эталон уже есть — **ручной connect** (`OhsEndpoints`, `POST …/connect`):

- `connection.connect` — user·info, намерение оператора, `Подключение {id} («{name}»): …`;
- `connection.connecting` — system·warning, `status=underway`, `correlationId = connection:{id}:connect:{uid}`;
- `connection.connected` — system·**ok**, `status=resolved`, тот же corr (+ QUIK-хвост «Предыдущее подключение …»);
- `connection.connect_failed` — system·error, тот же corr.

То есть: имя в user-ленте, `ok` на позитивном переходе, один user-intent + сгруппированная system-серия
на общем `correlationId`. **Задача 7j.18 — подтянуть автопуть и инциденты к этому эталону.** Ручной путь
(connect/disconnect/closed) также приведён к id-first `Подключение {id} («{name}»)` (единый `ConnLabel`).

---

## 2. Диагноз (что сейчас, фактически)

### 2.1. Авто-подключение — `ConnectionSupervisor.cs`

| Код | Severity | Source | Текст (как есть) | Проблема |
|-----|----------|--------|------------------|----------|
| `connection.schedule_disconnect` | info | (default) | `Расписание: отключение {id} (вне окна / non-trading)` | сырой `id`, нет имени, нет corr |
| `connection.connecting` | info | (default) | `Расписание: подключение {id}, попытка {n}/{max}` | сырой `id`, `info` вместо `warning`+`underway`, нет corr серии |
| `connection.reconnecting` (Progress) | warning | (incident) | `Восстановление связи {id}: попытка {n}/{max}` | сырой `id` |
| `connection.connected` | **info** | (default) | `Расписание: соединение {id} установлено` | должно быть **ok**; сырой `id`; не сгруппировано с попытками |
| `connection.connect_failed` | error | (default) | `Расписание: не удалось подключить {id} за {max} попыток` | сырой `id`, нет corr |

### 2.2. Инциденты связи — `ConnectionManager.cs`

| Код | Ось | Severity | Текст (как есть) | Проблема |
|-----|-----|----------|------------------|----------|
| `connection.lost` | `Open(subject)` | error | `Связь потеряна: подключение {id} ({State})` | сырой `id`, нет имени |
| `connection.recovered` | `Resolve(subject)` | ok | `Связь восстановлена: подключение {id}` | сырой `id`, нет имени |

Инцидентная ось B (`Open→Progress→Resolve` по `LinkIncidentSubject(id)`) сама по себе корректна:
`lost` открывает, ретраи супервизора двигают в `underway`, `recovered`/ручной disconnect закрывают.
Ломается только **presentation**: имя и единообразие с эталоном.

---

## 3. Разрывы (gap list)

1. **Именование.** Автопуть и инциденты используют сырой `{id}` (`подключение 3`, `соединение 3`)
   вместо стандарта `Подключение {id} («{name}»)` (id — первичен). Ручной путь уже корректен.
2. **Severity.** `ConnectionSupervisor.connection.connected` — `info`; по правилу «позитивный переход =
   ok» (как в ручном и в `recovered`) должно быть **ok**.
3. **User/system-дисциплина.** Автопуть системный по природе (инициатор — планировщик, не оператор),
   но серия `connecting/connected/failed` публикуется без явного `sourceType` (default) и без
   user-intent-строки. Нужно осознанно проставить `sourceType: system` и решить, нужна ли одна
   user-строка «Расписание: планирую подключение …» (симметрия ручному `connection.connect`).
4. **Группировка (correlationId).** Серия попыток супервизора (`connecting` × N → `connected`|`failed`)
   не имеет общего `correlationId` — в ленте это россыпь строк, а не один сворачиваемый сеанс. Ручной
   путь группирует по `connection:{id}:connect:{uid}`. Нужен аналог для авто-сессии (напр.
   `connection:{id}:auto:{uid}` на серию до успеха или исчерпания попыток).
5. **Каталог NC.** [error-handling.md](error-handling.md) документирует только редактирование
   расписания. Рантайм (авто-connect, инциденты) в каталоге NC не описан.

---

## 4. Целевая модель (соглашения)

Переиспользуем правила из [error-handling.md](error-handling.md) §2:

- **Имя:** `Подключение {id} («{name}»)` — id первичен, имя в кавычках; в системном техаудите
  допускается только `{id}`.
- **Severity по смыслу перехода:** `connecting/reconnecting = warning` (в процессе, «жёлтый»),
  `connected/recovered = ok` (позитивный переход), `lost/connect_failed = error`,
  `schedule_disconnect = info` (штатное плановое отключение).
- **Source:** намерение оператора → `user`; исполнение и инциденты → `system`.
- **Correlation:** одна попытка/сессия/инцидент = один `correlationId`; серия сворачивается в ленте.
- **Резолв имени:** `ConnectionSupervisor` и `ConnectionManager` тянут `Name` через store/кэш
  подключения (как это делает `OhsEndpoints` перед публикацией). Единый helper (напр. `ConnLabel(id, name)`).

---

## 5. Каталог рантайм-NC (целевой)

### 5.1. Авто-подключение по расписанию (system)

| Ситуация | Код | Severity | Текст (цель) | corr |
|----------|-----|----------|--------------|------|
| Плановое отключение (вне окна) | `connection.schedule_disconnect` | info | `Подключение {id} («{name}»): плановое отключение по расписанию` | — |
| Попытка N/max | `connection.connecting` | warning (`underway`) | `Подключение {id} («{name}»): подключаю по расписанию, попытка {n}/{max}…` | `connection:{id}:auto:{uid}` |
| Успех | `connection.connected` | **ok** (`resolved`) | `Подключение {id} («{name}»): связь установлена{. Предыдущее подключение …}` (QUIK-хвост, как в ручном) | тот же |
| Исчерпаны попытки | `connection.connect_failed` | error | `Подключение {id} («{name}»): не удалось подключить за {max} попыток` | тот же |
| **Сбой тика** (плановый disconnect, чтение расписания, резолвер и т.п.) | `connection.auto_error` | error | `Подключение {id} («{name}»): сбой авто-управления связью — {суть}` | — (дедуп по сигнатуре) |

Прим.: `connection.auto_error` закрывает «молчаливые» фоновые падения тика супервизора (кроме
connect-фейлов — у них своя серия). Дедуп по сигнатуре исключения: одинаковая ошибка не спамит NC
каждые 15 c, повторно уведомляет лишь при её смене; успешный тик снимает дедуп.

### 5.2. Инциденты связи (system, ось Open/Progress/Resolve)

| Ситуация | Код | Ось | Severity | Текст (цель) |
|----------|-----|-----|----------|--------------|
| Обрыв | `connection.lost` | Open | error | `Подключение {id} («{name}»): связь потеряна ({state})` |
| Восстановление (ретрай) | `connection.reconnecting` | Progress | warning | `Подключение {id} («{name}»): восстановление связи, попытка {n}/{max}` |
| Восстановлено | `connection.recovered` | Resolve | ok | `Подключение {id} («{name}»): связь восстановлена` |

Детали (state/detail/attempt) — в `data`, не в заголовке (как в 7j.17).

---

## 6. План работ (последовательный)

1. **Хелпер имени.** Общий способ получить `«{name}»` в супервизоре/менеджере (store-lookup или кэш
   имени по `connectionId`); helper форматирования `ConnLabel(id, name)` в одном месте.
2. **`ConnectionSupervisor`.** Проставить имя во все строки; `connecting → warning + status=underway`;
   `connected → ok`; общий `correlationId` на авто-серию; `schedule_disconnect` — с именем.
3. **`ConnectionManager`.** Имя в `lost`/`recovered`/`reconnecting`; сверить severity (`lost=error`,
   `recovered=ok` — уже ок, только текст).
4. **Каталог.** Дописать рантайм-раздел в [error-handling.md](error-handling.md) (или сослаться на §5
   этого дока) — единый каталог NC.
5. **Приёмка (см. §7).** Живой прогон на Finam id=3: окно/вне окна, обрыв→ретрай→восстановление,
   исчерпание попыток.

---

## 7. Приёмочная матрица

| Сценарий | Ожидаемая лента NC |
|----------|--------------------|
| Наступило окно, авто-connect с 1-й попытки | `connecting`(warning) → `connected`(ok), один corr, имя во всех |
| Авто-connect, 2 фейла + успех | `connecting` ×3 (warning) → `connected`(ok), один corr |
| Авто-connect, исчерпаны попытки | `connecting` ×max (warning) → `connect_failed`(error), один corr |
| Вне окна / non-trading | `schedule_disconnect`(info) с именем |
| Обрыв во время окна | `lost`(error, Open) → `reconnecting`(warning, Progress) → `recovered`(ok, Resolve), один инцидент-corr |
| Ручной connect (регресс) | без изменений: `connect`(user·info) → `connecting`(warning) → `connected`(ok) |

Критерий готовности: во всех строках рантайма — `Подключение {id} («{name}»)`; позитивные переходы —
`ok`; авто-серия и инцидент сворачиваются по одному `correlationId`; ручной путь не задет.

| Сбой тика по подключению (напр. падение планового disconnect) | `connection.auto_error`(system·error) с именем; при повторе той же ошибки — без спама |

---

## 8. Перспектива (backlog)

- **Общий мост Serilog → NC.** Точечный `connection.auto_error` (7j.18) закрывает per-connection сбои
  тика супервизора, но остальные фоновые пути (`TradeBatcher`, `LivenessProbe`, `RecordingSupervisor`,
  `ConnectorSession` pump, WS) при ошибке пишут **только в лог**. Общее решение — тонкий
  `ILogEventSink`: «ERROR+ по модулю `ohs.*` → NC (system·error/critical)» как safety-net для всех
  фоновых путей. Это относится к полному phase 11.2 (`ILogger`-sink), делается отдельно.
- **Падение всего тика** (`ReconcileAsync`/`ListAutoEnabledAsync`, напр. недоступность БД) сейчас —
  `LogError` в `RunAsync` без NC (не per-connection). Кандидат на тот же общий мост.
