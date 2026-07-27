# Phase 7j — Issues: инциденты связи и точность разрыва

Статус: **I1–I8 РЕАЛИЗОВАНО** · **I9** — mitigation в vite; prod-checklist OPEN.
Диагностика I1–I5 — живой тест 23.07.2026; I6/I7 — 24.07.2026; I8 — 25–26.07.2026
([nc-availability.md](nc-availability.md)); I9 — 26.07.2026 (после рестарта Host).
Часть сценариев принята на Finam id=3. Инцидентный контур 7j закрыт (кроме J11b);
остаток фазы — **7j.15/7j.16** ([todo.md](todo.md)); UI NC Thread → **phase 11**.

Связано: [auto-connect.md](auto-connect.md), [error-handling.md](error-handling.md), [report.md](report.md),
[incident.md](incident.md), 7h (лента Connection / `link_liveness`).

---

## 0. Как воспроизвели (живой тест Finam, 23.07.2026, время МСК)

Лента NC (факт):

| Время | Событие | Трек (correlationId) |
|---|---|---|
| 16:48:49 | правило `16:50–17:00` утверждено (`batch_applied`) | — |
| 16:50:10 → 16:50:36 | Auto: `connecting`(warning 1/5) → `connected`(ok) | `connection:3:auto:ca0128f5` |
| 16:57:44 | правка на лету `16:50→17:10` (`изменено`), при connected — без реконнекта ✅ | — |
| **~16:58–17:05** | **короткий разрыв VPN ~43 c — в NC пусто, в `link_liveness` дырки нет** | — |
| 17:08:01 | `connection.lost`(error, **open**) «связь потеряна (Down)» | `connection:3:link:1eb79fd3` |
| 17:08:07 | `connecting`(warning 1/5) + `reconnecting`(warning) | auto:87671c79 / link:1eb79fd3 |
| 17:08:31 | `connected`(**ok**) «…пред. сеанс — обрыв связи» ✅ | `connection:3:auto:87671c79` |
| — | **`recovered` НЕ пришёл** — инцидент трека link висит открытым | `connection:3:link:1eb79fd3` |
| 17:10:02 | `schedule_disconnect`(info) — конец окна; в журнале причина = «отключение оператором» ❌ | — |

Итог теста: короткий разрыв невидим; длинный разрыв фиксируется, но инцидент не закрывается;
плановое отключение маркируется неверной причиной.

---

## I1. Плановый disconnect маркируется как «отключение оператором»

**Симптом.** `schedule_disconnect` по авто-окну закрывает `link_liveness` причиной
`LinkCloseReason.Disconnected` → в контексте «пред. сеанс» и на ленте выглядит как ручное
«отключение оператором».

**Причина.** `DisconnectAsync` всегда закрывает живость `LinkCloseReason.Disconnected`:

```254:260:services/online-history-server/src/Scinverse.Ohs.Host/ConnectionManager.cs
        // Добровольный дисконнект: закрываем живость связи как 'disconnected' (серый на ленте, не разрыв).
        if (hasSource)
        {
            await linkLiveness
                .CloseAsync(sourceId, LinkCloseReason.Disconnected, null, cancellationToken)
                .ConfigureAwait(false);
        }
```

**Решение (согласовано).** Добавить `LinkCloseReason.Scheduled` (миграция `enum`/справочника + фронт-маппинг
цвета/подписи на ленте) и прокинуть причину в `DisconnectAsync(reason)`; авто-путь супервизора передаёт
`Scheduled`. Текст «пред. сеанс — плановое отключение по расписанию».

**Затрагивает.** `LinkCloseReason` (Domain), миграция (DbUp), `LinkLivenessStore`, `ConnectionManager.DisconnectAsync`,
`ConnectionSupervisor` (плановый disconnect), фронт-легенда ленты Connection, `LinkCloseReasonText`.

---

## I2. Инцидент связи не закрывается при реконнекте супервизора (нет `recovered`)

**Симптом.** После `connection.lost` связь реально поднялась (`connected` ok), но
`connection.recovered` не пришёл — инцидент трека `link:*` остаётся открытым навсегда.

**Причина.** Два независимых трека: авто-серия супервизора (`connecting→connected`) и инцидент связи
(`lost→reconnecting→recovered`). `connected`(ok) закрывает трек авто-серии, но **не** инцидент.
Инцидент закрывается только в `HandleLinkStateAsync` на `Live` при `previous ∈ {Down,Error}`:

```460:471:services/online-history-server/src/Scinverse.Ohs.Host/ConnectionManager.cs
                var recovering = hadState && previous is ConnectorLinkState.Down or ConnectorLinkState.Error;
                if (recovering)
                {
                    await recordings.Value.OnLinkLiveAsync(connectionId, CancellationToken.None).ConfigureAwait(false);
                    var label = await ResolveLabelAsync(connectionId, CancellationToken.None).ConfigureAwait(false);
                    notifications.Resolve(
                        LinkIncidentSubject(connectionId),
                        "connection.recovered",
```

Но реконнект супервизора идёт через `ConnectAsync → DisconnectAsync`, а тот стирает `_linkStates`:

```251:251:services/online-history-server/src/Scinverse.Ohs.Host/ConnectionManager.cs
        _linkStates.TryRemove(connectionId, out _);
```

→ новая сессия рапортует `Live` с `hadState=false → recovering=false` → `Resolve/recovered` не вызывается.

**Решение (согласовано).** На `Live` закрывать инцидент связи **идемпотентно**, не завися от in-memory
`recovering` (`Resolve` — no-op, если инцидента нет). Ре-подписку (`OnLinkLiveAsync`) оставить под
`recovering`. Так трек `link:*` закроется своим `recovered` даже после полного передисконнекта.

**Затрагивает.** `ConnectionManager.HandleLinkStateAsync` (ветка `Live/Degraded`).

---

## I3. Короткий разрыв данных невидим (детект завязан на `server_status` и порог 45 c)

**Симптом.** Разрыв VPN ~43 c: данные реально не шли, но ни инцидента в NC, ни дырки в `link_liveness`.
В шапке был жёлтый «Восстановление…» (Degraded), но след в журнале отсутствует.

**Причина.** Живость связи продлевается двумя путями, оба «проглотили» короткий разрыв:
- keepalive-тик (15 c) двигает `to_ts` **пока `Connector.IsConnected == true`** — DLL TRANSAQ ещё
  считала сессию живой, `server_status=false` не пришёл;
- порог `MaxGap = max(probe·3, 45) = 45 c`, разрыв 43 c < 45 → `HeartbeatAsync` не рвёт интервал.

```73:77:services/online-history-server/src/Scinverse.Ohs.Host/LivenessProbe.cs
            if (session.Connector.IsConnected)
            {
                await linkLiveness.HeartbeatAsync(session.SourceId, now, MaxGap, cancellationToken)
                    .ConfigureAwait(false);
            }
```

Детект разрыва сейчас = «коннектор сказал Down» ∨ «пропущено > 45 c keepalive». Для записи ПОТОКА
этого мало: важна непрерывность **входящих данных**, а даже 5 c простоя = дырка (восстановимая по меткам).

**Требования (пользователь).**
- Любой простой = разрыв, фиксируется.
- Точное время начала (по последней активности/сделке) и восстановления.
- На resolve инцидента — точная длительность перерыва.
- Всё пишется в журнал.

**Целевая модель (согласовано, вариант B).**
- **«Активность» = входящие сделки.** `_lastData` обновляется только на `TradeEvent` (см.
  `ConnectorSession.PumpAsync`). Наш keepalive (`LivenessProbe` тик 15 c) и `server_status` коннектора —
  это сигналы живости, **НЕ** входящие данные, и таймер тишины НЕ сбрасывают (иначе замаскируют дырку).
  Котировки сейчас не инжестятся; появятся — добавим в «активность».
- **Границы по активности, не по событию коннектора:** `gapStart = lastTradeAt` (последняя сделка),
  `gapEnd = firstTradeAt` (первая сделка после восстановления). Интервал `link_liveness` закрывать по
  `lastTradeAt`, а не тянуть keepalive пока `IsConnected` — тогда дырка в журнале честная и совпадает с data-gap.
- **Порог тишины `T = 15 c`** (обоснование: интервал агрегации сделок 30 c ⇒ `T = 30/2 = 15 c`). `T` —
  только чувствительность детектора; сам факт и границы разрыва фиксируются точно по меткам сделок.
- **Watchdog + подтверждение пингом (тихий рынок vs разрыв):** в торговом окне, если `now − lastTradeAt > T`
  — активный `ProbeAsync`:
  - **пинг не прошёл ⇒ подтверждённый разрыв ⇒ `connection.lost`(error)** с `gapStart = lastTradeAt`;
  - **пинг прошёл, сделок нет ⇒ тихий рынок ⇒ инцидента нет** («нет сделок» ≠ «нет связи»).
  - Отдельный `connection.stalled`(warning) НЕ заводим — сразу `lost`(error) по подтверждению.
- **Восстановление:** первая сделка после инцидента ⇒ `recovered` (идемпотентно, см. I2). Заголовок «связь
  восстановлена», в expanded — «Перерыв 00:00:43 (17:04:17 → 17:05:00 МСК)»; в `data` — `gapStart/gapEnd/gapMs`.

**Детект-латентность.** Тик probe = 15 c, `T = 15 c` ⇒ разрыв ловится за ~15–30 c + время пинга. Граница
`gapStart` при этом точная (метка сделки), латентность влияет только на момент публикации `lost`.

**Затрагивает.** `LivenessProbe` (watchdog, закрытие по activity), `ConnectionManager`
(`_lastData`/`_firstTradePending`, публикация `stalled`/`recovered` с длительностью), `link_liveness`
(честные границы), фронт (легенда/длительность на ленте и в NC).

**Реализация (7j.19).** `LivenessProbe`: существующий путь «тишина > `probeInterval`(15 c) + `IsConnected`
+ активный `ProbeAsync`» при провале пинга вызывает `ConnectionManager.ReportStallAsync(id, lastTradeAt)`.
`ReportStallAsync` идёт общим путём `OpenLinkLostAsync` (тот же, что и `server_status` Down): открывает
`connection.lost`(error), закрывает `link_liveness` причиной `PingFailed` **на `lastTradeAt`** (честная
левая граница дыры), гасит статус → супервизор реконнектит. Дедуп: если инцидент уже открыт или статус
уже «вниз» — тик 15 c тихо выходит (без спама). Начало разрыва хранится в `_incidentSince` (переживает
передисконнект реконнекта).

**Отступление от модели (осознанно).** `gapEnd = момент `Live` новой сессии` (реконнект завершён), а не
`firstTradeAt`. При стелс-разрыве коннектор не шлёт `Down`, старая сессия мертва — данные возобновятся
только на новой сессии; `Live` наступает за секунды до первой сделки. `recovered` публикуется в ветке
`Live` `HandleLinkStateAsync` по `_incidentSince.TryRemove` (идемпотентно, I2), длительность = `Live −
lastTradeAt`. Если понадобится точность до первой сделки — перенести resolve в `ReportActivity`.

---

## I4. `connected`: чистый заголовок + детали в expanded (оба пути)

**Симптом.** Детали «предыдущего подключения/сеанса» сейчас в заголовке `connected` — длинная строка.

**Решение (согласовано).** Заголовок чистый — `Подключение 3 («Finam»): связь установлена.`; детали
(`Предыдущее подключение — … МСК`, `Пред. сеанс — <причина>, … МСК`) — в expanded `data.lines`.
Применяем к **обоим** путям: ручной (`OhsEndpoints /connect`) и авто (`ConnectionSupervisor`).

**Затрагивает.** `OhsEndpoints` (`connection.connect`/`connected`), `ConnectionSupervisor` (авто-`connected`),
`ConnectionManager.DescribePreviousConnectionAsync`/`PreviousConnectionSuffix` (вернуть строки, а не суффикс).

---

## I5. AUTO-тумблер связи всегда янтарный (баг таймзоны в `isConnectedNow`)

**Симптом.** AUTO-тумблер связи почти всегда горит янтарным (`connecting`), особенно «после
пробуждения» dev-машины, хотя бэк в `disconnected`/idle и по расписанию момент **вне окна**. F5 не
помогает.

**Причина (точная).** Фаза AUTO при неподнятой связи зависит только от `inWindow` (клиентская
`isConnectedNow`). А `isConnectedNow` считает время в **локальной TZ браузера**, тогда как времена
правил — в TZ расписания (`settings.tz = "Europe/Moscow"`):

```92:95:services/online-history-server/web/src/core/connectionSchedule.ts
export function isConnectedNow(rules: readonly ConnectionScheduleRuleDto[], now: Date): boolean {
  const nowMinToday = now.getHours() * 60 + now.getMinutes();
```

`now.getHours()` — локальные часы (dev-машина UTC+7), `open`/`end` — по МSK ⇒ сдвиг **+4 ч**
(`ymd()`/`getDay()` тоже локальные ⇒ дата/день недели тоже скользят у полуночи). Пример: локально
07:58 (03:58 МSK) ⇒ `nowMinToday=478` попадает в окно `main` [360,1500) (06:00→01:00) ⇒
`inWindow=true` ⇒ янтарь; а по МSK 03:58=238 вне окна ⇒ должно быть зелёным.

**Почему «всегда» и F5 не лечит.** Баг детерминированный (TZ-сдвиг), не состояние — перезагрузка
считает то же. Плюс окно `main` шириной 19 ч ⇒ локально почти всегда «внутри», а связь после сна
`disconnected` ⇒ фаза `connecting` = янтарь. Корреляция «после сна» случайна (просто в этот момент
связь не поднята).

**Влияние.** Только индикатор фазы AUTO на фронте — на бэк/коннекты **не влияет** (серверная логика
своя, подтверждено: попыток к Finam нет). Но вводит оператора в заблуждение.

**Решение.** В `isConnectedNow` (и `resolveWinnerForDate`/`ymd`/`getDay`) вычислять время в TZ
расписания: сдвинуть `now` на московский офсет (уже есть `tzDateOf(ms, offsetMin)` в `moexSession.ts`,
`МSK = +180`) и читать `getUTC*` со сдвинутой даты. Прокинуть офсет из `displayTz$`/`settings.tz`.

**Родство.** Отдельно есть класс «фронт не догоняет бэк после сна/разрыва WS» (потерянный терминальный
статус, ср. I2 на клиенте) — кандидат: refetch снапшота (`connections`+`connectionSchedule`) на
`visibilitychange → visible` и WS-реконнекте. Это уже второстепенно: основной баг янтаря — TZ.

**Статус:** ИСПРАВЛЕНО (отдельный фронт-фикс, ждёт визуальной проверки). В `connectionSchedule.ts`
добавлен `SCHEDULE_TZ_OFFSET_MIN=180` + `wallClockInTz`; `isConnectedNow` считает `now` в TZ расписания
(МSK). `tsc` зелёный.

---

## I6. После авто-реконнекта связь «зелёная» (connected), но сделок нет — теряется ре-подписка

**Симптом.** После обрыва и авто-переподключения супервизором тумблер связи горит **зелёным**
(`waiting` — «подключён, данных нет»), NC показывает `connected`/`recovered`, но **ни одной сделки не
приходит**. На Finam воспроизводится **всегда** после реконнекта: связь на уровне протокола есть, поток
данных стоит. Внешне выглядит как «TRANSAQ не может запуститься».

**Причина.** Подписка на инструменты (`SubscribeTradesAsync`) живёт на **сессии коннектора** и ставится
лишь в двух местах: `RecordingManager.StartAsync` (старт записи оператором) и `OnLinkLiveAsync`
(ре-подписка после восстановления). В `ConnectionManager.ConnectAsync` подписки нет — значит **новая
сессия после реконнекта поднимается без подписок**, и вернуть их может только `OnLinkLiveAsync`. Но её
вызов был **защёлкнут in-memory флагом `recovering`**:

```473:476:services/online-history-server/src/Scinverse.Ohs.Host/ConnectionManager.cs
                var recovering = hadState && previous is ConnectorLinkState.Down or ConnectorLinkState.Error;
```

Реконнект супервизора идёт через `ConnectAsync → DisconnectAsync`, а тот **стирает `_linkStates`**
(строки 263–267). Поэтому первый `Live` новой сессии приходит с `hadState=false ⇒ recovering=false` ⇒
`OnLinkLiveAsync` **пропускается** ⇒ подписки не восстанавливаются ⇒ сделок нет.

**Почему это именно новый подход, а не старый.** `recovering` (in-memory «предыдущее состояние было
Down/Error») задумывался как признак «мы восстанавливаемся после известного обрыва». Он корректен
**только** для сценария `Down→Live в одной и той же сессии`. Но для TRANSAQ (и вообще для авто-реконнекта)
это **неверная предпосылка**: коннектор `server_status=Down` часто не шлёт, а восстановление идёт
**только через новую сессию** (супервизор пересоздаёт её через `DisconnectAsync`, обнуляя `_linkStates`).
В момент, когда данные реально возобновляются, «памяти о том, что был обрыв», уже нет — значит гейт
`recovering` **структурно не может** сработать для главного продакшн-сценария. Это тот же корень, что и в
I2 (реконнект стирает `_linkStates`): там его обошли через `_incidentSince`, но **ре-подписку осознанно
оставили под `recovering`** — и на ней баг сохранился.

**Решение (I6).** Развязать ре-подписку от `recovering`: звать `OnLinkLiveAsync` на **любом** `Live/Degraded`.
Метод **идемпотентен** — он пропускает записи с активным покрытием (`if (coverage.IsActive) continue;`),
а при обрыве `OnLinkDownAsync` покрытие закрывает; значит на «нормальном» коннекте (покрытие уже открыто
`StartAsync`) он ничего не задваивает, а после реконнекта (покрытие закрыто обрывом) — честно
ре-подписывается и открывает новый сегмент. `recovering` остаётся только для перехода статуса и лога.
Философия — та же, что в фиксе I2: **факт «связь снова жива» первичен, in-memory `previous` — ненадёжен.**

**Затрагивает.** `ConnectionManager.HandleLinkStateAsync` (ветка `Live/Degraded`). Store/контракты не
меняются, миграции не нужны.

**Статус:** ИСПРАВЛЕНО (код; компиляция чистая — полная сборка/тесты после остановки запущенного Host).

---

## I7. Гонка хартбитов живости → `duplicate key … uq_capture_liveness_open`

**Симптом.** В живом логе 24.07.2026 во время `Degraded↔Live` флапов связи прилетало необработанное
исключение `LivenessProbe`:

```text
12:27:23 [ERR] Ошибка тика живости захвата
Npgsql.PostgresException: 23505: duplicate key value violates unique constraint "uq_capture_liveness_open"
  TableName: capture_liveness  ConstraintName: uq_capture_liveness_open
  at CaptureLivenessStore.HeartbeatAsync ... :line 33  (InsertOpenAsync, ветка open is null)
```

**Причина (гонка).** `HeartbeatAsync` читает открытый интервал `SELECT … WHERE open FOR UPDATE`, и если
его нет — делает `INSERT`. Но **`FOR UPDATE` при отсутствии строки блокировать нечего**: два конкурентных
хартбита одного источника оба видят `open is null` и оба вставляют → нарушение частичного уникального
индекса `uq_capture_liveness_open (source_id) WHERE open`. Писателей живости минимум два и они идут
параллельно:
- тик `LivenessProbe` (каждые 15 c) → `HeartbeatAsync`;
- `ConnectionManager.ReportActivity` (**на каждой сделке**) → `OnDataAsync` → `HeartbeatAsync`.

На флапе `Degraded→Live` эти пути легко совпадают в момент, когда открытого интервала нет (только что
закрыли), и гонка материализуется. **Тот же дефект — в `LinkLivenessStore.HeartbeatAsync`** (идентичный
паттерн, индекс `uq_link_liveness_open`).

**Почему так делать нельзя.** `read-then-insert` без сериализации — классический upsert-race; `FOR UPDATE`
не покрывает несуществующую строку. Плюс исключение всплывало как **необработанное** в фоне (только в лог,
не в NC) — молчаливая потеря хартбита и «рваная» живость (ложные микроразрывы на ленте/подложке).

**Решение (I7).** Сериализовать критическую секцию по источнику через `pg_advisory_xact_lock(ns, sourceId)`
в начале транзакции `HeartbeatAsync` (namespace `910010` = capture, `910020` = link). Лок держится до
`commit/rollback` и снимается автоматически; конкурентный хартбит того же источника ждёт, затем честно
видит уже открытый интервал и **продлевает** его вместо второго `INSERT`. Покрывает и ветку
«open is null», и «закрыть старый + открыть новый» (>maxGap). Схема/миграции не меняются; разные namespace
для двух таблиц исключают лишнюю блокировку между ними.

**Затрагивает.** `CaptureLivenessStore.HeartbeatAsync`, `LinkLivenessStore.HeartbeatAsync`.

**Перспектива.** Само необработанное фоновое исключение (`LivenessProbe` пишет только в лог) — кандидат на
общий мост Serilog→NC (`ohs.*` ERROR → system·error), см. [auto-connect.md §8](auto-connect.md).

**Статус:** ИСПРАВЛЕНО (код; компиляция чистая — полная сборка/тесты после остановки запущенного Host).

---

## I8. Инцидент недоступности бэка: стек рассыпается после reload (v1 → v2)

**Контекст.** Отдельная от I1–I7 нить: инцидент **доступности бэка** (`backend.*`, client-driven, бэк во
время простоя мёртв), не инцидент связи с биржей. Полная модель, разбор и целевая спека — в
[nc-availability.md](nc-availability.md) (детект §3, персист §4, два слоя исключений §6.1, спека v2 §9).
Здесь — фиксация самих сложностей.

**Симптом (живой тест 25.07.2026).**
- После F5 стек инцидента **рассыпается**: втянутые `ohs.unhandled` (500) отвязываются от нити и всплывают
  отдельными строками, часть — «раньше» открытия простоя (порядок групп плывёт).
- Трижды дёрнул `GET /api/test-exception` — в live прилетел **один** FATAL; после reload — **все три**,
  отдельными строками. Итог: **live ≠ reload**, история нечитаема.

**Причины (три, тянут врозь).**
1. Бэк вешает на **каждый** `ohs.unhandled` уникальный `correlationId = requestId` → в БД N разных 500 =
   N нитей, ни одна не привязана к простою:

```79:90:services/online-history-server/src/Scinverse.Ohs.Host/GlobalExceptionHandler.cs
        notifications.Publish(
            code: "ohs.unhandled",
            message: "Внутренняя ошибка сервера: необработанное исключение (500)",
            severity: "critical",
            ...
            correlationId: requestId);
```

2. Фолд `foldUnhandledIntoOutage` (см. [nc-availability.md](nc-availability.md) §6.1) живёт **только в
   сессии** — в БД лежит оригинал с `requestId`, гидрация возвращает его мимо инцидента.
3. `NotificationBus.dedupIncidentPhases` схлопывает по `(corr, code, status)` → N фолднутых 500 (один corr,
   один code, один status) → в live остаётся **один**; в БД их N (разные corr). Плюс NC сортирует группы по
   новейшему событию → после reload разные группы разъезжаются по времени.

**Почему сложно (корень).** Правило «corr чеканит владелец БД». Сейчас БД = бэк = NC на одной машине; при
простое бэк (= NC) мёртв → минтить corr некому → клиент минтит провизорный (`ohs.backend.outage:<startMs>`).
Раскол авторства (500 = бэк-минт `requestId`, простой = клиент-минт `startMs`) и делал нить разорванной.
Кросс-акторная координация (бэк дозакрывает нить, начатую клиентом) — территория внешнего NC
([nc-availability.md](nc-availability.md) §8).

**Решение (v2, согласовано — [nc-availability.md](nc-availability.md) §9).**
- Ось **Sender** (`client`/`backend`/`supervisor`/`transaq`/`nc`), пока в `data.sender` + expanded, без
  миграции (§9.1).
- **Единый corr на инцидент + правило adopt**: автор первого персистимого события чеканит corr, остальные
  adopt-ят; при эскалации 500→простой клиент берёт бэк-минтованный `requestId` (§9.2).
- **Одиночный 500 → health-probe**: «Проверка работоспособности: OHS штатно» либо эскалация с adopt
  `requestId`; висящих FATAL нет (§9.3).
- **Дедуп только фаз-прогресса** (`*.progress`/`recovering`); отдельные fatal не схлопываем → видно все N,
  как в БД (§9.4).
- **Персист всего стека** (open + каждый fatal + warning + resolve), тики — нет (§9.5). Итог: **reload = live**.

**Затрагивает.** `GlobalExceptionHandler` (corr активного инцидента вместо `requestId`, когда «held`),
`ClientRecoveryGate`/`holdRecovery` (передача активного corr), `OhsStore` (health-probe + adopt, фолд не как
механизм персиста), `NotificationBus.dedupIncidentPhases` (whitelist фаза-кодов), `notifications.ts` + бэк
`Publish` (`data.sender`), NC-компонент (рендер sender в expanded). Миграций пока нет (`sender` в `data`).

**Статус:** РЕАЛИЗОВАНО ([nc-availability.md](nc-availability.md) §9; коммиты `8bdfc6c`, `f9595d2`, `735690a`).

---

## I9. Admin UI «мёртвый» после рестарта Host: `localhost` → IPv6, Kestrel на `::1` залип

**Симптом (26.07.2026).** После рестарта OHS Host фронт на Vite (`:5174`) поднимается, но UI пустой:
«Нет подключений», NC пуст. В DevTools — пачка `AjaxError` / `message: 'aborted'` / `status: 0` на
`getConnections` / `getCoverage` / `getSources` / … Процесс Vite жив; Host по API тоже отвечает — но
**только по IPv4**.

**Замер (факт):**

| Путь | Результат |
|---|---|
| `http://127.0.0.1:5080/api/connections` | **~17 ms, 200** |
| `http://[::1]:5080/api/connections` | **таймаут ≥10–20 s** |
| `http://localhost:5174/api/connections` (Vite proxy → `localhost:5080`) | **таймаут** (идёт в `::1`) |

На Host в этот момент на `::1:5080` копились `CloseWait` / `Established`; слушатель `127.0.0.1:5080`
оставался живым. Vite слушал только `::1:5174`; proxy target был `http://localhost:5080`.

**Причина.** Не баг React/OhsStore и не «сломанный» vite-config как таковой. Конфиг со `localhost`
**годами работал**, пока dual-stack Host отвечал и по IPv4, и по IPv6.

1. На Windows `localhost` часто резолвится в **`::1` раньше**, чем в `127.0.0.1`.
2. Vite proxy ходит на `localhost:5080` → попадает в **IPv6**-сокет Kestrel.
3. После жёсткого рестарта Host / лавины оборванных WS+HTTP (`ECONNRESET` → `ECONNREFUSED` в логе Vite)
   путь **`::1` залипает** (полузакрытые сокеты), а **IPv4 остаётся здоровым**.
4. Браузерные XHR через proxy висят → клиент abort (`status: 0`) → стор не наполняется → UI «не
   поднимается», хотя бэкенд «вроде жив» (проверка с `127.0.0.1` обманывает).

Отдельно: сам процесс Vite иногда умирал с `ELIFECYCLE … exit code 4294967295` (= `-1` на Windows) —
внешнее убийство дерева процессов, не исключение приложения. Это усиливает хаос при рестарте Host, но
корневой «пустой UI при живом Vite» — именно **proxy → залипший IPv6**.

**Mitigation (dev, сделано).** В `web/vite.config.ts` target proxy зафиксирован на IPv4:

```ts
const OHS_TARGET = 'http://127.0.0.1:5080';
```

**Учесть при переходе на production (обязательно):**

| Риск | Что сделать |
|---|---|
| Dual-stack bind | Явно решить: listen только `0.0.0.0` / конкретный IPv4, или корректный dual-stack с health на обоих. Не оставлять «случайно жив только один стек» без мониторинга. |
| Имя хоста в reverse-proxy | Nginx/Caddy/Traefik/`localhost`/DNS A+AAAA: upstream должен резолвиться в **тот** адрес, на котором Kestrel реально здоров. Предпочтительно литерал IPv4 или отдельный DNS без сюрпризов AAAA. |
| Healthchecks | Проверять тот же URL/family, что использует фронт/proxy (не только `127.0.0.1` с консоли админа). Иначе green health при мёртвом пути для UI. |
| Рестарт / rolling | После kill −9 / crash Host — смотреть полузакрытые сокеты и зависания accept на одном family; readiness не отдавать, пока probe по боевому адресу не зелёный. |
| Клиентский abort | `AjaxError aborted` / `status: 0` трактовать как «сеть/proxy/hang», не как «пустой каталог»; UI — явный offline/retry, а не вечное «Нет подключений». |
| Admin Front vs Vite | На prod Vite proxy не будет; тот же класс бага возможен на любом hop `имя → AAAA → залипший listener`. Закладывать в runbook. |

**Затрагивает.** Dev: `vite.config.ts` (proxy target). Prod: bind Kestrel, reverse-proxy upstream,
health/readiness, runbook рестарта Host. Код доменной модели 7j не меняется.

**Статус:** MITIGATION (dev) · OPEN для prod-checklist (gate Admin Front / вынос за Vite).

---

## Сводка решений

| # | Проблема | Решение | Статус |
|---|---|---|---|
| I1 | Плановый disconnect = «оператором» | `LinkCloseReason.Scheduled` + миграция | РЕАЛИЗОВАНО |
| I2 | `recovered` не приходит после реконнекта | идемпотентный `Resolve` / `CloseIncidentAsync` | РЕАЛИЗОВАНО |
| I3 | Короткий разрыв данных невидим | watchdog + `lost` + длительность в `recovered` | РЕАЛИЗОВАНО |
| I4 | `connected` перегруженный заголовок | чистый заголовок; expanded → JSON `result`+`sender` (не `lines`) | РЕАЛИЗОВАНО |
| I5 | AUTO-тумблер всегда янтарный | `isConnectedNow` в TZ расписания | РЕАЛИЗОВАНО |
| I6 | После авто-реконнекта нет сделок | `OnLinkLiveAsync` на любом `Live` | РЕАЛИЗОВАНО |
| I7 | Гонка хартбитов / duplicate key | `pg_advisory_xact_lock` в Heartbeat | РЕАЛИЗОВАНО |
| I8 | Простой бэка: live ≠ reload | Sender + единый corr + персист стека + warn-before-ok | РЕАЛИЗОВАНО |
| I9 | UI пустой: `localhost`→`::1`, IPv6 Kestrel залип | proxy → `127.0.0.1`; prod: bind/health/proxy family | MITIGATION / prod OPEN |

Остаток 7j: 7j.15/7j.16 + J11b ([todo.md](todo.md)). NC Thread / UI — [../phase11/plan.md](../phase11/plan.md).
Gate Admin Front + NC — 11→12 ([../plan.md](../plan.md)).

**Вне scope 7j (уровень данных).** Задержка ~3 мин до «первых данных» после connect (зелёный `waiting`
не сменяется голубым `active`) — это **data-path**: блокирующая регистрация справочника инструментов в
pump, не connection-lifecycle. Вынесено отдельно → [phase7h/startup-latency.md](../phase7h/startup-latency.md).
7j остаётся про соединение: запуск / инциденты / восстановление связи.
