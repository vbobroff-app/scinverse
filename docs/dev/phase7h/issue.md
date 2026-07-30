# Phase 7h. Issue: reconnect TRANSAQ / тумблер уходит в «Ошибка»

Зафиксирован сбой повторного подключения Finam/TRANSAQ после обрыва связи: пользователь
включает тумблер, UI показывает «Ошибка», в консоли `POST /api/connections/{id}/connect` → 400.

**Статус:** `OPEN`. **Дата:** 2026-07-16.  
**Связанные:** [incident.md](incident.md), [plan.md](plan.md), [report.md](report.md).

---

## Симптомы

1. После успешного connect сессия некоторое время жива (`waiting` / `active`).
2. Без действия пользователя статус внезапно становится `disconnected` (тумблер «Отключён»).
3. Повторное включение крыжика → жёлтый «Подключение…» → **«Ошибка»**.
4. В DevTools:
   - `TRANSAQ 'connect' failed: Соединение с сервером уже устанавливается...`
   - и/или `TRANSAQ connect: не получено подтверждение соединения за 30 с`
   - HTTP 400 на `POST /api/connections/3/connect`

---

## Наблюдение (Finam, connectionId=3, 2026-07-16)

| Время (UTC+7) | Событие |
|---------------|---------|
| 08:58:03 | `ConnectAsync` — попытка |
| 08:58:16 | связь `Live`, connect 200 (~13 с) |
| 09:00:00 | связь **`Down`** (`server_status` от шлюза, detail=null) — **не** явный disconnect из UI |
| 09:14:10 | переподключение (осиротевшая сессия, статус был `disconnected`) |
| 09:14:12 | **второй** `ConnectAsync` (~2 с спустя) → 400: *«уже устанавливается…»* |
| 09:14:41 | первый connect → 400: таймаут 30 с без `connected="true"` |

Важно: обрыв в 09:00 — сигнал **шлюза** (`ConnectorLinkState.Down`). Host только отразил статус и
закрыл сегменты записи; native-сессию при Down **не** гасит через `disconnect`.

---

## Корневые причины (гипотезы, подтверждённые логами)

### 1. Осиротевшая сессия после Down

На `Down` / `Error` `ConnectionManager.HandleLinkStateAsync`:

- ставит UI-статус `disconnected` / `error`;
- закрывает liveness / сегменты;
- **не** вызывает `DisconnectAsync` → объект `ConnectorSession` остаётся в `_sessions`.

Повторный connect идёт по ветке «переподключение»: сначала `DisconnectAsync`, затем новый
`ConnectAsync`. Если native DLL / Finam после обрыва ещё в состоянии connect — шлюз отвечает
*«соединение уже устанавливается»* или молчит до таймаута 30 с.

### 2. Гонка параллельных ConnectAsync

Между снятием сессии из `_sessions` и успешной регистрацией новой сессии (после долгого
`await connector.ConnectAsync`) второй `POST /connect` **не видит** активную сессию и стартует
ещё один native connect.

Типичный триггер: двойной клик по тумблеру или повторный клик, пока статус ещё `connecting`
(фронт оптимистично ставит `connecting`, но при `error`/`disconnected` повторный клик снова
зовёт `connect`).

На бэке **нет** per-connection lock на connect.

### 3. Каталог опционов (смежный факт той же сессии)

В выгрузке `<securities>` после connect 08:58 пришли MCT/SHARE/BOND/FUT/…, **OPT = 0**.
ATM-страйки RI на 16.07 в каталоге по-прежнему отсутствуют — это ограничение/состав дампа
шлюза, не UI. Отдельно от бага тумблера, но важно для ожиданий по цепочке опционов.

---

## Текущее поведение кода (карта)

```
UI ConnectionToggle
  → OhsStore.connect → POST /api/connections/{id}/connect
       → ConnectionManager.ConnectAsync
            → [если сессия есть и status waiting|active|degraded] → early return
            → [если сессия есть и status disconnected|error] → DisconnectAsync, затем connect
            → factory.Create → TransaqConnector.ConnectAsync
                 → SendCommand(<command id="connect">…)
                 → WaitAsync(server_status connected="true", timeout 30s)
            → ConnectorSession.StartAsync → pump securities/alltrades
```

На `server_status connected="false"`:

```
HandleLinkStateAsync(Down)
  → SetStatus(disconnected)
  → Close link liveness (server_down)
  → OnLinkDownAsync (сегменты)
  → сессия в _sessions остаётся (orphan)
```

---

## Предлагаемые фиксы

| # | Что | Где | Зачем |
|---|-----|-----|-------|
| A | Per-connection lock / single-flight на `ConnectAsync` | `ConnectionManager` | Второй POST не стартует native connect, пока первый не завершился |
| B | На `Down`/`Error` — явный teardown: `DisconnectAsync` (или эквивалент) после обработки | `HandleLinkStateAsync` | Не оставлять осиротевшую native-сессию; чистый reconnect |
| C | Фронт: игнор `onConnect`, пока локальный статус `connecting`; не слать второй POST | `ConnectionToggle` / `OhsStore.connect` | Убрать двойной клик как триггер гонки |
| D | После неудачного connect — best-effort native `disconnect` перед возвратом 400 | `TransaqConnector` / `ConnectAsync` catch | Сбросить «уже устанавливается» на шлюзе |

Минимальный пакет для снятия симптома тумблера: **A + C**; устойчивость после обрыва шлюза: **B + D**.

---

## Как проверить после фикса

1. Connect → дождаться `waiting`/`active`.
2. Инжект Down (`debug/drop` на synthetic) или дождаться реального `server_status=false`.
3. Один клик тумблера → снова `waiting` без `Ошибка`.
4. Двойной клик во время «Подключение…» → второй запрос не уходит / бэк отвечает уже идущим connect, без 400 «уже устанавливается».
5. Регресс: обычный disconnect из UI по-прежнему гасит сессию и даёт чистый reconnect.

---

## Операционная особенность Finam (подтверждено 2026-07-16)

Finam/TRANSAQ **может сам гасить сессию** вне торгового окна и **не принимать новый login**
до примерно **часа до открытия торгов**.

Наблюдение той же сессии:

| Время | Факт |
|-------|------|
| 08:58 | connect OK |
| 08:59:58 | в `logs/transaq/*_ts.log`: **`Server is to be down.`** |
| 09:00:00 | `server_status connected="false"`, у нас `Down` |
| после | все reconnect: `WSAE:10060` / `Failed to login` / `connection error` — TCP до `tr1.finam.ru:3900` не проходит |
| ~05:xx МСК | Supervisor: `inSession=false` (окно FORTS с 07:00 МСК) |

Рестарт OHS **не помогает**: native DLL чистая, шлюз просто не пускает. Тумблер «Ошибка» в этом
окне — ожидаемый симптом недоступности Finam, а не только баг гонки connect.

**Практика:** не долбить connect ночью/рано утром; пробовать снова ближе к часу до сессии
(для дневного окна FORTS — ориентир ~06:00 МСК). Параллельно оставляем фиксы A–D, чтобы
дневные обрывы/двойной клик не усугубляли ситуацию.

---

## Workaround (сейчас)

1. Не кликать тумблер повторно, пока жёлтый «Подключение…» (~35 с).
2. При устойчивой `Ошибка` вне торгового окна — **подождать до ~1 ч до открытия сессии**; рестарт Host сам по себе Finam не «откроет».
3. После обрыва в торговые часы — подождать 30–60 с, один connect; если снова `10060` — смотреть доступность `tr1.finam.ru:3900`.

---

## Заметка: залп coverage → пул Npgsql exhausted (→ 7j I12)

**Не отдельный баг 7h-ленты**, а триггер: UI параллельно зовёт
`/api/coverage`, `/coverage/link`, `/coverage/activity` (после recover Host **или** break /
WiFi cut) → `Max Pool Size` исчерпан → пачка `ohs.unhandled` (500) в NC, часть FATAL
остаётся `ACTIVE`.

Полный разбор и направления фикса (основное: **RxJS**-синхронизация refresh coverage;
пул / close-all single 500) →
**[phase7j/issue.md I12](../phase7j/issue.md#i12-после-recover-пул-npgsql-exhausted--пачка-ohsunhandled-500-orphan-active-fatal)**.

---

## Issue: после выхода из сна писатели не возобновляют запись (OPEN, 2026-07-25)

После пробуждения машины из сна **связь восстанавливается, но запись (writer) не возобновляется**: UI
показывает «всё работает», а по факту данных нет.

### Симптомы

1. Тумблер **«Подключён»** (зелёный), гант **connection** — живой (синий), NC показывает штатное
   восстановление (`connection.recovered` + `backend.recovered`).
2. Но на **recording**-лентах инструментов (RTS/SBRF/Si-9.26) после сна — **нет живости**: серо/красная
   штриховка «данных нет», хотя связь есть.
3. То есть writer'ы «слушают», но сделки не транслируются / не пишутся — сегменты записи не открылись
   заново после реконнекта.

### Контекст / повтор

- Ровно то, что уже отмечалось ранее: «после подключения писатели так и не запустились — видно, что
  слушают, сделки не транслируются» (после сна на ганте).
- Воспроизведение: сон/Modern Standby → серия дропов/восстановлений связи → на выходе connection = Live,
  но recording-поток мёртвый.

### Гипотезы (требуют проверки логами)

1. На `Down`/`Degraded` сегменты записи и liveness закрываются (`OnLinkDownAsync`), а на возврате в `Live`
   **не переоткрываются** — нет ветки «re-arm записи по восстановлению линка».
2. Подписка на `alltrades` (pump `ConnectorSession`) после реконнекта native-сессии не восстановлена
   (осиротевшая/новая сессия без повторного subscribe), поэтому сделки не идут в `TradeBatcher`.
3. `RecordingSupervisor`/`RecordingManager` не реагирует на смену состояния линка `→ Live` возобновлением
   активных записей (расхождение: connection-supervisor поднял связь, а recording-путь не дёрнут).

### Как проверить (после фикса / при разборе)

1. После сна при `Live`-связи: идут ли `alltrades` в pump сессии; растёт ли `TradeBatcher`; тикает ли
   capture-liveness.
2. Открылись ли новые сегменты записи по возврату в `Live` (а не остались закрытыми с `Down`).
3. Регресс: обычный disconnect→connect из UI возобновляет запись корректно (т.е. проблема именно в
   авто-восстановлении связи без переоткрытия записи).

### Заметка о приоритете

На проде сна нет, но тот же путь актуален для **любого авто-восстановления связи** (обрыв → Live): нужно
убедиться, что запись переоткрывается по возврату в `Live`, а не только при ручном reconnect.
