# Phase 7j — Недоступность бэка и контекст удалённого хоста NC

Статус: **КОД ГОТОВ · приёмка на живом (два стека + reload=live)**. §9 (единый corr, health-probe,
warn-before-ok, persist стека, sort by `ts`) + system expanded JSON (`fd3e93e`). Коммит стека —
`8bdfc6c`. Внешний NC-server — gate 11→12 / to-be C4. **Обновлено:** 2026-07-26.

Связано: [error-handling.md](error-handling.md) (§8/§8.1 — краткая выжимка ссылается сюда),
[incident.md](incident.md) (инциденты **связи** — отдельная нить), [report.md](report.md).

---

## 0. Зачем это (проблема)

NC ловит инциденты **связи с биржей** (`connection.*`), но **сам факт недоступности OHS-бэка** до этого
нигде не отражался:

- Фронт при обрыве WS молча ретраил (`retry({delay:2000})`), пользователь не знал, что сервер лежит.
- Startup-recovery закрывает осиротевшие интервалы `link_liveness` причиной `interrupted` (краш/рестарт),
  но только пишет `LogWarning` — **в NC ничего**. На ганте краш видно (красная штриховка), в ленте — нет.
- Итог: непонятно, **во сколько отвалился бэк** и **как долго лежал**.

Нужен явный сигнал недоступности **client↔backend** — отдельный от здоровья линка к бирже.

---

## 1. Два уровня, не путать

| уровень | про что | кто детектит | где в NC |
|---|---|---|---|
| **связь с биржей** | TRANSAQ/Finam ↔ сервер: Degraded/Down/переподключение | бэк (`ConnectionManager`/супервизор) | инциденты `connection.*` ([incident.md](incident.md)) |
| **доступность бэка** | клиент ↔ OHS-бэк: процесс жив и отвечает | **клиент** (дроп WS) | инцидент `backend.*` (этот док) |

Ключевое: **бэк не может сообщить о собственном простое, пока лежит.** Значит инцидент недоступности бэка
**ведёт клиент** — в отличие от инцидентов связи, где оркестратор переходов — `NotificationHub` на бэке.
Здесь владелец жизненного цикла — фронт (`OhsStore` + `notifications.ts`).

Граница строгая: «бэк доступен/штатно» ≠ «коннектор подключён к бирже». Иначе вне окна расписания / в
выходной инцидент недоступности «не закрылся бы» (коннектор законно не подключён). «Штатно» = **бэк
отвечает и клиент ре-синхронизировал состояние**.

---

## 2. Модель: инцидент из 4 фаз (corr-стек)

Единый `correlationId` per-outage: `ohs.backend.outage:<startMs>` (новый простой → новая нить).

| фаза | severity · status | code | сообщение |
|---|---|---|---|
| **open** | `critical` (fatal) · active | `backend.unavailable` | Сервер OHS недоступен, жду восстановления |
| **progress** | `error` · underway | `backend.unavailable.progress` | Сервер OHS недоступен · N с *(живые тики)* |
| **warning** | `warning` · underway | `backend.recovering` | Сервер OHS доступен, идёт восстановление системы… |
| **resolve** | `ok` · resolved | `backend.recovered` | Система восстановлена, сервер OHS функционирует штатно |

Обоснование эскалации severity: первый удар громкий (`critical` — будит), тики — `error` (не переорут, но
бейдж «горит»), warning — жёлтый транзит подъёма, resolve — зелёный, бейдж гаснет. На ступень выше
инцидента связи (там `error → warning → ok`), т.к. недоступность всей системы серьёзнее одного обрыва.

**Живые тики (I2 upsert):** повторы `error`/underway с тем же `code` обновляют строку **на месте**
(«· 5 с» → «· 10 с»), поэтому каждый тик — свежий `id` (иначе дедуп шины по `id` его отбросит).

---

## 3. Стейт-машина (фронт)

`OhsStore`, кормится колбэками `createLiveStream` (`live.ts`): `onDrop` (closeObserver, после однажды живой
связи — первичный неуспех коннекта простоем не считаем) и `onReconnect` (openObserver).

```
        drop                 grace 6c истёк                re-open WS + refresh
 none ─────────▶ grace ───────────────────▶ open ──────────────────────────▶ warning
   ▲               │ re-open в grace           │  error-тики каждые 5 c            │
   │               │ (блип) → тихий сброс       │                                  │ settle 5c
   │               ▼                            │◀── повторный дроп (crash-loop) ───┤ без нового дропа
   └──────────────────────────────── resolve (ok) ◀───────────────────────────────┘
```

- **grace 6 c** (`BACKEND_OUTAGE_GRACE_MS`) — глушим тривиальные блипы (Vite HMR / быстрый рестарт). Дроп
  короче grace → инцидента вообще нет.
- **open** — `openBackendOutage` (fatal, `ts` = момент дропа = backdated начало) + интервал `error`-тиков
  (`BACKEND_OUTAGE_TICK_MS` = 5 c). Первый тик — через каденцию (fatal-строка держится «чистой» пару секунд).
- **warning** — на re-open WS: стоп тиков, `warnBackendOutage`, взвод settle.
- **settle 5 c** (`BACKEND_OUTAGE_SETTLE_MS`) — связь должна продержаться без нового дропа. Триггер ok =
  refresh-батч ответил (`getConnections`-проба, тот же Kestrel, что и WS) **и** settle истёк.
- **crash-loop** — повторный дроп во время warning/settle = бэк снова упал → **тот же** инцидент назад в
  `error` (без нового fatal), `outageStart` сохраняется. Одна нить на всё «мигание».

---

## 4. Персистентность: mock-POST задним числом

Пока бэк лежит, POST невозможен → тики/warning **эфемерны** (только локальная шина). На закрытии инцидента
шлём в NC **open + resolve** задним числом:

- **Эндпоинт**: `POST /api/notifications` (`OhsEndpoints`) → `NotificationHub.Ingest(...)` пишет событие
  **вербатим** (клиентский `id` + backdated `ts`) в ring-buffer + аудит-лог и broadcast'ит по WS.
- **`id` = Guid-N** (32 hex без дефисов) — системное соглашение: аудит-лог хранит `EventId` как uuid
  (`Guid.ParseExact(id,"N")`), не-Guid id ломает запись (см. §6). `correlationId` — свободная строка (persist
  как text), группировка/upsert по нему.
- **Дедуп**: echo POST'а приходит по WS с тем же `id` → шина отбрасывает (open переиспользует `id`/`ts`
  из локальной нити; resolve шлёт свой). Так инцидент **переживает reload** (гидрация из БД).
- **Длительность** — в expanded у resolve: «Недоступен HH:mm:ss → HH:mm:ss (МСК) · N с».
- **Реализация**: `notifications.ts` держит карту нитей `outageThreads` по `startMs` (open эмитится по grace,
  resolve — по settle; между ними нужно помнить `id`/`ts` open для переиспользования в POST).

**Точность начала простоя** — по часам **клиента**, ± цикл WS-retry (~2 c). Более точный источник —
`link_liveness.to_ts` осиротевшего интервала (backend-side, см. §7). Для mock достаточно клиентских часов.

---

## 5. Файлы (код-мапа)

- `web/src/core/live.ts` — `createLiveStream(url, onReconnect, onDrop)`, `closeObserver`.
- `web/src/core/OhsStore.ts` — стейт-машина (`onBackendDrop`/`startOutageProgress`/`onBackendReachable`/
  `armOutageSettle`/`resolveOutage`, `clearOutageTimers`), роутинг входящих (`onServerNotification` — фолд
  + блокировка, §6.1), константы grace/tick/settle.
- `web/src/core/notifications.ts` — `openBackendOutage`/`tickBackendOutage`/`warnBackendOutage`/
  `resolveBackendOutage`, `foldUnhandledIntoOutage` (§6.1), карта `outageThreads`, `guidN`, `mskHms`,
  `formatOutageDuration`.
- `web/src/core/api.ts` — `postNotification`.
- `src/Scinverse.Ohs.Host/NotificationHub.cs` — `Ingest(...)` + `IngestNotificationRequest`.
- `src/Scinverse.Ohs.Host/OhsEndpoints.cs` — `POST /api/notifications` (+ валидация id = Guid-N → 400).
- `src/Scinverse.Ohs.Host/NotificationPersistWriter.cs` — per-item guard `TryMap` (см. §6).
- `src/Scinverse.Ohs.Host/GlobalExceptionHandler.cs` — split `BadHttpRequestException` → `ohs.request_error`
  (error) vs настоящее 500 → `ohs.unhandled` (critical) (§6.1).

---

## 6. Регрессия: mock-POST ронял весь Host (закрыто)

**Симптом**: пользователь выключил бэк один раз, но получил ДВА fatal-инцидента, и после второго они
пропали из NC.

**Причина**: первый вариант фичи слал уведомление с клиентским id `ohs.backend.outage:<ms>:done`.
`NotificationPersistWriter` при сдаче в аудит-лог делает `Guid.ParseExact(id,"N")` → не-Guid → `FormatException`.
Вызов `ToRecord` стоял **вне** try/catch → исключение вылетало из `BackgroundService` → политика
`BackgroundServiceExceptionBehavior.StopHost` роняла **весь Host**. Отсюда «второй краш» (его вызвал
POST фичи, а не пользователь) и пропажа fatal (writer падал ДО записи в БД → гидрация после рестарта пустая).

**Фиксы** (все в этой же фазе):
1. `NotificationPersistWriter` — per-item guard `TryMap`: битое событие пропускается с логом, **Host не
   падает** (аудит-лог — не критичный путь, как и заявлено в его доке). Это structural-фикс: никакое
   NC-событие больше не может уронить процесс.
2. `notifications.ts` — id уведомлений в формате **Guid-N**.
3. `POST /api/notifications` — валидация `id = Guid-N → 400` (чёткий контракт).

### 6.1. Необработанные исключения во время инцидента (два слоя: error vs fatal)

Живой разбор: сразу после падения/рестарта, пока фронт переустанавливает связь и шлёт пачку запросов
(`refreshConnections`/`refreshCoverage`/`refreshLiveness`), запрос «в стык» ловит `POST /api/coverage/link`
с оборванным телом → `BadHttpRequestException: Failed to read parameter … from the request body as JSON`.
`GlobalExceptionHandler` ловил **любое** исключение → публиковал `ohs.unhandled` (**critical/FATAL**) с
`correlationId = requestId` (W3C-trace) → отдельный сирота-FATAL с чужим corr, мимо стека инцидента.

«Необработанное исключение» — **двух природ**, различает их только бэк (по типу). Единый словарь severity
NC (`ok/info/warning/error/critical`); отдельного уровня между «error» и «fatal» нет — `critical` **и есть**
«FATAL:». Поэтому — **два слоя, только error + fatal**:

| природа | пример | severity | HTTP | инцидент простоя |
|---|---|---|---|---|
| **транспортный шум** | оборванное/некорректное тело, рестарт-гонка, кривой JSON (`BadHttpRequestException`) | **error** (`ohs.request_error`) | статус из исключения (400) | не трогает |
| **настоящее 500** | реальный баг в живом бэке (`ohs.unhandled`) | **critical/fatal** | 500 | **втягивается в стек + блокирует закрытие** |

- **Слой 1 (бэк, `GlobalExceptionHandler`)**: `BadHttpRequestException` → `ohs.request_error`
  (**error**, не FATAL и **не** warning — сбой запроса в браузере это ERROR-уровень), статус из
  исключения, лог `Warning`. Убирает сироту-FATAL от рестарт-гонки в корне (это не краш сервера).
  *Почему не блокирует инцидент:* при восстановлении такие гонки — норма; блокируй мы на них — settle бы
  никогда не закрылся (фронт сам генерит эти запросы). Настоящее 500 остаётся `ohs.unhandled` critical.
- **Слой 2 (фронт, `OhsStore.onServerNotification` + `notifications.foldUnhandledIntoOutage`)**: пока
  инцидент простоя **показан** (`open`/`warning`), входящий `ohs.unhandled` (critical) → (а) публикуется под
  `correlationId` инцидента, оставаясь `critical` (тот же вес «FATAL:», но **внутри** нити — кликом по corr
  виден весь стек, а не сирота); (б) считается «бэк жив, но нестабилен» → гасим settle и возвращаемся в
  `error`-прогресс (как повторный дроп). Инцидент закроется только когда бэк реально стабилен.
  В `grace` (fatal ещё не показан) не фолдим — grace-таймер откроет инцидент штатно.
- **Голова группы — по новейшему событию** (`NotificationBus.statusOf`/`countUnread`, newest-first), поэтому
  `critical` в середине нити не отравляет зелёное закрытие: терминальный `ok/resolved` эмитится последним.
- **Персист-оговорка**: настоящий `ohs.unhandled` бэк всё равно персистит под своим (trace) corr → после
  reload вернётся отдельной строкой (фолд пока для живого показа). Честный кросс-акторный фолд требует общего
  ключа инцидента — территория внешнего NC (§8). Слой 1 при этом убирает самый частый (шумовой) случай.
  **→ Снимается в v2 (§9): единый corr на инцидент + персист всего стека дают reload = live.**

---

## 7. Backend-side путь (комплементарный, будущее)

Startup-recovery уже отделяет краш от обрыва на уровне хранилища:

- **Живой процесс, обрыв линка** → `ping_failed`/`server_down` в работе → инцидент связи в NC.
- **Процесс умер** → интервал `link_liveness` остался `open` → на следующем старте
  `RecoverOpenIntervalsAsync` закрывает его причиной `interrupted` (лента Connection рисует красной
  штриховкой). `UPDATE` не трогает `to_ts` → интервал заканчивается на **последнем keepalive перед смертью**
  = готовая **backdated-точка начала простоя**.
- Keepalive `link_liveness` **отвязан от writer-ов** (в `LivenessProbe.TickAsync` heartbeat связи идёт до
  гейта записи), поэтому `to_ts` корректен даже при всех выключенных writer-ах (± один probe-интервал).

Будущее: бэк на полном старте мог бы сам эмитить авторитетный `resolve` (и истинное время падения из orphan
`to_ts`) в ту же нить. Мешает кросс-акторная координация: бэк не знает клиентский `correlationId` простоя —
это уже территория внешнего NC (§8).

---

## 8. Контекст: NC как удалённый (внешний) сервис

Направление (абстрактно; детали — когда наберётся больше информации):

- **NC выносится в отдельный внешний сервис**: своё облако, своя БД уведомлений, поставка как
  **MFE-компонент**. Единая шина для всех сервисов микросервисной архитектуры (не только OHS).
- **Сейчас — mock-behaviour, optimistic pattern**: клиент публикует уведомление **оптимистично локально**
  (показываем сразу, не дожидаясь подтверждения), тот же контракт позже уходит POST'ом во внешнюю NC.
  Меняется только транспорт, UX неизменен. `POST /api/notifications` + `Ingest` — и есть этот mock:
  контракт внешнего NC, временно приземлённый в тот же хаб/лог.
- **Backdated-запись** — часть контракта: POST может нести **прошлый `ts`** (событие произошло раньше
  доставки). Мотив — недоступность бэка: POST уходит только по восстановлении, а отключение было раньше.

### Открытые вопросы / боли (решаем при выносе)

1. **Дедуп между клиентами**: несколько вкладок/машин → каждая заведёт свой инцидент недоступности
   (разные `correlationId`) → дубли в общем логе. Нужен серверный дедуп/коалесинг по «естественному ключу»
   инцидента (напр. окно недоступности сервиса), а не по клиентскому `correlationId`.
2. **Авторитетность client-события**: клиентские часы vs серверное время; кто «прав» о времени/факте.
   Backend-side orphan `to_ts` (§7) — более авторитетный источник начала простоя.
3. **Кросс-акторная нить**: чтобы бэк дозакрыл инцидент, начатый клиентом, нужен общий детерминированный
   ключ инцидента (не per-client `startMs`).
4. **Durability**: если бэк умирает до async-флаша persist-очереди — событие теряется. Внешняя NC со своим
   стораджем и подтверждением приёма это снимает.
5. **Множественные источники**: единая NC-шина принимает события от многих микросервисов → нужна схема
   атрибуции/маршрутизации и единый контракт `Ingest`.
6. **Порядок ленты / event-time vs insert-time**: backdated ingest (§4) ломает порядок «как вставили»
   (см. §9.5.1). На внешнем NC `List` обязан отдавать newest-first по `ts` (или писать фазы без
   догонялок) — клиентская сортировка по `ts` тогда перестаёт быть источником истины.
7. **Ось temporary (хранить или нет)** — см. §9.8: сейчас неявна («тики просто не POST-им»); на
   внешнем NC — first-class в контракте `Ingest` / схеме, чтобы persist-правила не были размазаны по клиентам.

Боли намеренно **не углубляем** — вернёмся, когда будет больше вводных под вынос.

---

## 9. v2 — Sender, единый corr, персист всего стека (РЕАЛИЗОВАНО)

**Статус: реализовано 2026-07-25** (§9.1 Sender + §9.4 дедуп — коммиты `f9595d2`/`735690a`; §9.2 единый
corr на бэке + §9.3 health-probe/adopt + §9.5 персист стека — этот заход). Развилки закрыты (см. 9.7).

**Проблема v1 (наблюдаемая на трёх скринах):** после reload стек рассыпается. Причины — три, тянут в разные
стороны:

1. Бэк вешает на **каждый** `ohs.unhandled` уникальный `correlationId = requestId` (`GlobalExceptionHandler`)
   → в БД N разных 500 = N нитей, ни одна не привязана к простою.
2. Фолд (§6.1) живёт **только в сессии** — в БД лежит оригинал с `requestId`, гидрация возвращает его мимо
   инцидента.
3. `dedupIncidentPhases` схлопывает по `(corr, code, status)` → N фолднутых 500 → **один** live; в БД их N
   (разные corr) → **live ≠ reload**, и порядок групп плывёт (NC сортирует группы по новейшему событию).

**Цель v2:** reload воспроизводит live **1-в-1**, история инцидента читается сверху вниз («500 уронил бэк →
чинимся → восстановлено», с реальной длительностью).

### 9.1. Ось Sender

Новая **машинная** ось атрибуции — «кто прислал message в NC и отвечает за операцию». Ортогональна
`interaction` (user|system) и `actorLabel` (ярлык показа).

| sender | смысл |
|---|---|
| `client` | фронт: события, что фронт авторствует сам (детект простоя, health-probe ok, live-тик) |
| `backend` | OHS-бэк (`GlobalExceptionHandler`, `ConnectionManager`) |
| `supervisor` | `ConnectionSupervisor` (планировщик / овнер восстановления связи) |
| `transaq` | коннектор (события шлюза) |
| `nc` | будущий внешний NC-сервис |

- **Пока — без миграции:** `data.sender` в JSON expanded (+ chip `sender:` в meta). Значение сейчас
  литерал `client` / `backend` / `transaq` / `supervisor`; при многих клиентах — `client_id` (или аналог).
  Промоция в first-class колонку — при выносе NC (§8).
- Связь с `Owner` инцидентов связи ([incident.md](incident.md)): `Sender` = «кто прислал ЭТО событие»,
  `Owner` = «кто отвечает за восстановление». Часто совпадают, держим раздельно.
- Все клиент-авторские события простоя несут `sender=client` — честно маркирует провизорность (live-часть,
  которую не персистим, после reload пропадёт — и это ожидаемо).

### 9.2. Единый corr на инцидент + правило adopt

**Corr чеканит владелец БД** (сейчас бэк, потом NC-server). Клиент минтит corr только когда бэк (= NC, одна
машина) мёртв и чеканить некому — тогда corr провизорный, `sender=client`.

Правило: **на инцидент — ровно один corr; его создаёт автор ПЕРВОГО персистимого события инцидента**, все
последующие — adopt-ят.

| триггер | автор corr | corr |
|---|---|---|
| 500 у живого бэка | бэк | `requestId` (W3C-trace) |
| 500 → бэк упал (эскалация) | бэк (500 был первым) | клиент **adopt-ит `requestId`** как corr всей нити простоя |
| холодный простой без 500 (kill / старт вперёд бэка) | клиент (бэк ничего не отчеканил) | `ohs.backend.outage:<startMs>` |
| 500 во время уже открытого простоя | автор простоя | стамп в текущий corr инцидента (см. 9.5) |

Нарратив нити. **Главный инвариант: к OK всегда через WARNING** — не бывает `FATAL → OK`
(ни open→ok, ни mid-stack 500→ok без recovering). WARNING = «снова проверяем штатность», не
квитанция на каждый 500. Тики progress — temporary (§9.8).

Пачка mid-stack 500 (один warn на всю пачку после кулдауна без нового 500):

```
t+00:00  [FATAL]   Сервер OHS недоступен…                    open           — упал
t+01:00  [WARNING] Сервер OHS доступен, идёт восстановление… recovering#1  — чиню
t+01:02  [FATAL]   500 #1                                    ohs.unhandled
t+01:02  [FATAL]   500 #2                                    ohs.unhandled  — пачка (client ещё
t+01:03  [FATAL]   500 #3                                    ohs.unhandled    не «перепроверил» WS)
t+01:09  [WARNING] Сервер OHS доступен, идёт восстановление… recovering#2  — снова чиню
t+01:14  [OK]      Система восстановлена…                    resolve
```

Одного WARNING после пачки достаточно: между 500#1…#3 фазу recovering осмысленно не
перезаходили. Если 500 разнести дальше кулдауна — будет `warn → fatal → warn → fatal` (каждый
раз успели войти в recovering) — тоже ок. Один и тот же ts у warning и следующего fatal
(или fatal чуть позже) — норма (гонка колбэка / клик в ту же секунду).

Инвариант: `… → FATAL → … → WARNING → OK` (перед resolve всегда warn). Каждый вход в recovering —
**отдельная** строка + mock-POST. `since` в warning нет — нить по corr; в expanded —
`sender=client`.

Единственное «что мешало» единой нити — раскол авторства corr (500 = бэк-минт, простой = клиент-минт).
Adopt снимает раскол: клиент переиспользует бэк-минтованный `requestId` вместо своего.

**Hold как можно раньше (race со swagger / `test-exception`):** `GlobalExceptionHandler` штампует
`ohs.unhandled` corr'ом инцидента только пока `ClientRecoveryGate.ActiveCorrelationId` задан
(`POST /recovery/hold`). Если hold слать лишь при входе в warning (после WS-reconnect), 500 через
swagger **до** reconnect уходит под W3C `requestId` («бешеный corr») — вне стека. Поэтому:

1. клиент долбит `holdRecovery(corr)` **с фазы open** (ретраи ~2 с, пока бэк не ответит 2xx);
2. `outageHeldSignaled` — только после успеха (не до запроса);
3. если 500 всё же проскочил с чужим corr — live-fold в corr инцидента + пере-POST того же `id` с
   исправленным corr (persist/reload).

### 9.3. Одиночный 500 (инцидента нет) → health-probe

Инвариант: **любой `ohs.unhandled` обязан закрыться каким-то `ok`** (висящих FATAL нет).

```
none + ohs.unhandled (critical, corr=requestId, sender=backend)
        │  клиент пробит health (getConnections / /health — тот же Kestrel, что WS)
        ├─ бэк отвечает ──▶ [OK] «Проверка работоспособности: сервер OHS функционирует штатно»
        │                        corr=requestId  sender=client → нить закрыта
        └─ не отвечает / дроп WS в grace ──▶ эскалация: adopt requestId, штатный стек простоя (9.2)
```

- Health-probe ok — клиент-авторский, но corr бэк-минтованный (`requestId`) → персист группируется с 500.
- В debug 500 не роняет процесс (бэк устоял) → почти всегда ветка «Проверка ОК». На prod необработанное
  роняет сервак → ветка эскалации.

### 9.4. Дедуп: I2 для тиков, discrete строки стека — нет

Upsert / `dedupIncidentPhases` по `(corr, code, status)` — для обычных I2-фаз (тики `*.progress`,
`connection.recovering`, повторный `connection.lost`…).

**Discrete (не схлопываем):** `critical` / `ohs.unhandled`, `backend.recovering`, `backend.unavailable`,
`backend.recovered`, `backend.healthcheck.ok`. Иначе N×500 и N×warn «чиним» схлопнутся → live ≠ reload.

### 9.5. Персист: весь стек, кроме temporary-тиков

- **Персистим:** open (fatal) + **каждый** отдельный fatal + **каждый** recovering-warning + resolve (ok).
  Все под единым corr (9.2).
- **НЕ персистим тики** (`*.progress`) — ось temporary (§9.8): live-секундомер. Длительность — в expanded
  у resolve.
- **Автор персиста** — по 9.2: 500 пишет бэк; клиент-авторские (open, каждый warn, health-ok, resolve) —
  mock-POST (§4).

#### 9.5.1. Порядок в стеке после reload: сортировка по `ts` на шине (временный контракт)

**Симптом (живой):** live-стек читается верно (`ok → warning → fatal` newest-first / снизу вверх
причина→чиним→закрыто). После reload warning «убегает» вниз: `ok → fatal → warning` — хотя по датам
warning между fatal и ok.

**Причина:** insert-порядок в БД ≠ время события. Пока бэк лежит, `open` локален; в persist он уходит
**backdated mock-POST'ом вместе с resolve**. `warning` POST'ится раньше (бэк уже на связи). Гидрация
`GET /notifications` → `publish` по порядку вставки → шина клала backdated `open` *после* `warning`.

**Фикс сейчас:** `NotificationBus` всегда держит ленту **newest-first по `ts`** (`sortNewestFirstByTs`),
не по порядку ingest. При равном `ts` — стабильный порядок (новее по ingest выше). Контракт ленты =
«время события», а не «когда доехало до стораджа».

**Почему не «чище» прямо сейчас:** NC и OHS Host — одна машина; client-authored фазы пишутся
асинхронно и с backdated `ts` (§4, §8). Пока mock-POST приземлён в тот же хаб — серверный `List`
по insert/id не восстановит нарратив инцидента без той же сортировки по `ts`.

**Когда вынесем NC-server:** порядок — ответственность владельца БД уведомлений:
`List` / гидрация **по `ts` (или эквивалент event-time)** на сервере; фронт только показывает.
Либо фазы пишутся в правильном event-time порядке без backdated-догонялок. Тогда клиентский
`sortNewestFirstByTs` можно упростить до «доверяем порядку API» (или оставить как защитный
инвариант — дёшево). Зафиксировать при выносе (§8).

### 9.6. Код-карта (реализовано)

- `ClientRecoveryGate`: держит `ActiveCorrelationId` независимо от одноразового стартового барьера
  (`SetActiveIncident`/`ClearActiveIncident`), т.к. 500 у уже-поднявшегося бэка может прилететь в любой момент.
- `GlobalExceptionHandler`: `ohs.unhandled` штампуется `recoveryGate.ActiveCorrelationId ?? requestId`
  (единый corr, пока клиент held); `requestId` + `sender:"backend"` уходят в `data`.
- `POST /api/recovery/hold`: тело `{ correlationId }` → `Hold()` + `SetActiveIncident(corr)`; `backend.recovered`
  через `POST /api/notifications` → `Release()` + `ClearActiveIncident()`. `holdRecovery(corr)` на клиенте.
- `OhsStore`: `outageCorr` (cold = `ohs.backend.outage:<startMs>` либо adopt `requestId`); hold-ретраи с
  фазы open (`signalHoldRecovery`); одиночный `ohs.unhandled` → `probeHealthAfterFatal` → ok | adopt;
  500 во время инцидента с чужим corr → `foldUnhandledIntoOutage` + пере-POST (race до hold).
- `NotificationBus`: I2-upsert только не-discrete; discrete = FATAL + `backend.recovering` + open/resolve
  простоя (9.4); `sortNewestFirstByTs` (§9.5.1).
- `warnBackendOutage`: каждый вход в recovering — новый id + mock-POST; перед OK всегда warn
  (пачка 500 → один warn после кулдауна). Expanded — `sender=client`, без `since`.
- Персист: open + каждый fatal + каждый recovering-warn + resolve + health-ok; тики = temporary (§9.8), не POST.

### 9.7. Решённые развилки

1. **Автор corr:** владелец БД (бэк-минт; клиент — только когда бэк мёртв). ✓
2. **N одинаковых 500:** показываем **все N** (не счётчик). ✓
3. **Одиночный 500 → потом краш:** **единая нить** через adopt `requestId` (не две нити). ✓
4. **Тики:** **не персистим** (ни промежуточные, ни финальный) — temporary (§9.8). ✓
5. **Порядок стека после reload:** newest-first по **`ts`** на шине (§9.5.1), пока NC на Host + backdated
   mock-POST; при выносе NC-server — `List` по event-time на сервере. ✓ (временно на клиенте)
6. **К OK только через WARNING** (не `FATAL→OK`); пачка mid-stack 500 → один warn после
   кулдауна, не warn на каждый 500. ✓
7. **`since` в warning:** убрали (YAGNI); нить по corr, в expanded — `sender=client`. ✓

### 9.8. Ось temporary = «хранить или нет» (на будущее, после переезда NC)

Не severity и не status. Ортогональная ось **жизни события в сторадже**:

| | persistent (default) | temporary |
|---|---|---|
| смысл | история инцидента / аудит | «сейчас», секундомер, шум каденса |
| примеры (простой бэка) | open, каждый 500, каждый recovering-warn, resolve | `backend.unavailable.progress` (тики `· N с`) |
| reload | в стеке | нет |
| роль | нарратив по corr | live UX |

**Сейчас (mock на Host):** ось **неявная** — клиент просто не POST-ит тики; warn/open/resolve POST-ит.
Контракт `Ingest` поля `temporary` не имеет.

**После выноса NC-server:** first-class в контракте (поле / флаг / отдельный lane), чтобы:
- persist-writer NC игнорировал temporary на приёме (клиент не обязан «знать и молчать»);
- гидрация/`List` не тащила temporary в историю;
- шина могла помечать temporary для UI (не «гореть» как unread после reload и т.п.).

Не путать с warning: recovering-warning — **persistent** («чинили» — факт в истории);
тики progress — temporary. Затравка зафиксирована; реализацию — при выносе (§8 п.7).
