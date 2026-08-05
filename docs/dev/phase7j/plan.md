# Phase 7j — Расписание соединения (Connection schedule)

> **Эволюция фазы.** v1 MVP (одно окно суток, V021) → **v2 якорная модель** (`open+duration`,
> слоистые правила `main/dow/date`, SCD-2 — [v2-exceptions.md](v2-exceptions.md)) → Notification
> Composer + UI diff-approve (7j.13/14) → **обработка исключений редактирования** (7j.17: атомарный
> `batch`/Saga + глобальный exception-handler — [error-handling.md](error-handling.md)) → **Auto Connect:
> исключения и инциденты** (7j.18 — [auto-connect.md](auto-connect.md)) → **инциденты связи и точность
> разрыва** (7j.19 — [issue.md](issue.md)) → **инциденты связи v2: один бит здоровья + владение
> (TRANSAQ→supervisor) + severity=error + ribbon v2** (7j.20 — [incident.md](incident.md)). Живой статус —
> [report.md](report.md).

**Статус:** инцидентный контур **7j.17–7j.20 + J11a/b/c + I10/I11** — **код + живая приёмка**
(Adopt crash-inside-break 2026-07-31). **I12 / 7j.22** — клиент **DONE** (шаги 1–2); Host pool
size **отложен** (остаётся 100). Очередь фазы (не инциденты): **7j.15** / **7j.16**. UI NC Thread →
**phase 11** ([../phase11/plan.md](../phase11/plan.md)). Итог модели —
[../../stage1/incident-model-wrapup.md](../../stage1/incident-model-wrapup.md). Зависимости: **7h / 7h.8**, **7c**, **7e**.
Соседняя **7i** — Auto записи. Gate Admin Front + NC — **11→12**. Детали — [apply.md](apply.md);
статус — [report.md](report.md); остаток — [todo.md](todo.md). **Обновлено:** 2026-07-31.

## Проблема

Связь с брокером поднимается вручную (тумблер в шапке провайдера). Ночной/выходной присмотр, обрывы
и повторные connect — на операторе. Лента Connection (7h.8) показывает факт связи, но **политики
«когда держать линк»** нет. И даже с расписанием: если авто-connect сбоит, связь рвётся, ретраи не
удаются — оператор должен это **видеть в Notification Center** единообразно, а не догадываться.

Запись (7i) сознательно **не** поднимает связь (TRANSAQ process-global) — владельцем расписания
connect является слой Connection.

## Идея

У **Connection** — своё расписание (якорь `open+duration` + слоистые исключения `main/dow/date`) и
**Auto**, зеркальный записи:

- Auto on → `ConnectionSupervisor` включает/выключает тумблер связи по окну + календарю ведущего `engine`;
- ручной off тумблера → Auto off; ручной connect при Auto off — без расписания;
- лента Connection / `link_liveness` — факт; запись и её лента — проекция живой связи;
- **все исключения и инциденты** (обрыв, ретраи, исчерпание попыток, ошибки БД, необработанные
  исключения) → в NC по единому стандарту (имя, severity, группировка) — как у редактирования (7j.17).

История правил — SCD-2 (операционная память).

## Зависимости

| Фаза | Что даёт 7j |
|------|-------------|
| 7e | Тумблер связи в `ProviderCard` (не двигаем) |
| 7h | `ConnectionManager`, `server_status`, reconnect, `LivenessProbe` 15 с |
| 7h.8 | `link_liveness`, `ConnectionRibbon`, ось инцидента связи |
| 7c | `IMarketCalendar` — торговые дни ведущего `engine` |
| 11 (тонкий срез) | `NotificationHub`/`INotificationPublisher` (Publish + инцидентная ось Open/Progress/Resolve); полный 11.2 — перспектива |

## Модель слоёв

```text
connection_schedule → ConnectionSupervisor → ConnectionManager → link_liveness / Ribbon
                              ↓ link live
recording_schedule  → RecordingSupervisor  → RecordingManager / coverage
```

## Дорожная карта под-фаз

Живой статус и лог — [report.md](report.md); ниже — scope и указатели.

| # | Область | Статус | Док |
|---|---------|--------|-----|
| 7j.1–7j.5 | v1 MVP: V021 окно + store/API + Supervisor + notify + UI + тесты | DONE (заменено v2) | — |
| 7j.6–7j.12 | **v2:** V024 якорь + слоистые правила, домен/резолвер, стор, супервизор, API, фронт, тесты | DONE | [v2-exceptions.md](v2-exceptions.md) |
| 7j.13 | Notification Composer (одно user + одно system на пачку) | DONE | [notify-composer.md](notify-composer.md) |
| 7j.14 | UI: двухшаговый diff-approve, guardrail main, live-push баннер | DONE | [ui-schedule.md](ui-schedule.md) |
| 7j.17 | Обработка исключений **редактирования**: атомарный `POST …/schedule/batch` (Saga) + глобальный `IExceptionHandler` + severity-модель + попап без оптимизма | DONE | [error-handling.md](error-handling.md) |
| 7j.18 | **Auto Connect: все исключения + инциденты** | **КОД ГОТОВ** | [auto-connect.md](auto-connect.md) |
| 7j.19 | **Инциденты связи + точность разрыва** (I1–I5) | **КОД ГОТОВ** | [issue.md](issue.md) |
| 7j.20 | **Инциденты связи v2** + **backend-outage v2** + system NC JSON + **J11a/J11c** abandon schedule | **КОД ГОТОВ** | [incident.md](incident.md) · [nc-availability.md](nc-availability.md) · [todo.md](todo.md) |
| **7j.21** | **I11:** единый close-break (Manager+Hub); атомарный Adopt; снять костыли `auto:`/лента | **КОД ГОТОВ** · приёмка | [issue.md](issue.md) I11 · [todo.md](todo.md) |
| **7j.22** | **I12:** pool exhausted → пачка 500 / orphan FATAL | **КЛИЕНТ DONE**; pool defer | [issue.md](issue.md) I12 · ниже |
| **7j.15** | Рыночный/календарный профиль на settings; UI без хардкода MOEX | **ОЧЕРЕДЬ** | [market-profile.md](market-profile.md) |
| **7j.16** | `date`-авторинг на фронте + пагинация графика по месяцам | **ОЧЕРЕДЬ** | [todo.md](todo.md) |

## Что осталось в 7j / куда ушло

**Инциденты связи/crash + I11 close-break — код готов, живая приёмка.** **I12 клиент — DONE.** Дальше:

1. **7j.15 / 7j.16** — market profile / `date`-авторинг ([todo.md](todo.md)).
2. **UI NC Thread** — **phase 11 DONE** — [../phase11/to-threads.md](../phase11/to-threads.md).
3. Смежно: **H1/H2** (recording-ribbon, 7h); **7i** Auto записи; **не** WebGL до gate 11→12.
4. **I12 шаг 3** — Host pool только если снова упрёмся в exhausted приёмкой (`Max Pool Size` пока **100**).

### 7j.22 — I12: пул Npgsql / orphan FATAL (КЛИЕНТ DONE · 2026-07-31)

Симптом: после recover Host **или** break UI залпом дергает coverage/liveness →
`The connection pool has been exhausted` → пачка `ohs.unhandled` (500); health-probe закрывает
только один corr → orphan ACTIVE FATAL. Канон эпизодов — [issue.md](issue.md) I12.

| # | Слой | Статус | Что |
|---|------|--------|-----|
| **1** | **Клиент** | **DONE** `6871a57` | `OhsStore`: `Subject` → `debounceTime(150)` → `switchMap` → `concat(coverage→activity→liveness)`; полный проход на любой триггер; задел под WebGL drag-zoom |
| **2** | **NC / I8 хвост** | **DONE** `327c8fe` | Пачка single-500 без outage: один health-probe → `closeRecentOrphanUnhandledWithHealthOk` закрывает **все** недавние orphan (окно 15 с) + mock-POST |
| **3** | **Host / пул** | **DEFER** | `Max Pool Size=100` **не поднимаем**; вернуться только если после (1)(2) на живой приёмке снова exhausted |

Сознательно **не** делали: поднять пул до 200; рестарт Host как «лечение».

### 7j.21 — план зачистки I11 (без наращивания костылей)

Порядок работ (код — отдельно, после согласования):

1. **Close-break helper** `CloseBreakAsync` — **КОД ГОТОВ**
   (`recovered` / `abandoned_schedule` / `abandoned_manual`).
2. **Adopt атомарно** (I10) — **КОД ГОТОВ**.
3. **Connect-fail → `link:`** без throwaway Group — **КОД ГОТОВ**.
4. **Лента** без synthetic `from+60s` / Transfer-на-teardown — **КОД ГОТОВ**.
5. Доки: [auto-connect.md](auto-connect.md), [incident.md](incident.md) §1.2 — **ГОТОВО**.

Критерий приёмки: после manual off / failed Adopt / reconnect ×N — нет «тишины» Progress/Append;
гант break = red 1px → yellow ≤T → red → green 1px **из данных**, не из UI-fallback.

---

## Завершено — 7j.18: Auto Connect по расписанию (исключения + инциденты)

### Цель

Довести авто-подключение по расписанию и обработку инцидентов связи до продакшн-уровня: связь
поднимается / держится / гасится по расписанию, а **все исключения и инциденты** (обрыв, ретраи,
исчерпание попыток, ошибки БД/инфраструктуры, необработанные исключения) видны в NC в **едином
стандарте** 7j.17 — с именем подключения, осмысленной severity и группировкой в один сворачиваемый
сеанс/инцидент.

Эталон уже существует — **ручной connect** (`POST …/connect`): user-intent + system-серия
`connecting(warning)→connected(ok)/failed(error)` на общем `correlationId`, имя `«{name}»`. Задача —
подтянуть авто-путь (`ConnectionSupervisor`) и инциденты (`ConnectionManager`) к этому эталону.

### Область (scope)

1. **Единый стандарт рантайм-NC** (наследует 7j.17):
   - имя `Подключение {id} («{name}»)` (id первичен) во всех строках supervisor/manager;
     в системном техаудите допускается только `{id}`;
   - severity по смыслу перехода: `connecting/reconnecting = warning`, `connected/recovered = ok`,
     `lost/connect_failed = error`, `schedule_disconnect = info`;
   - source: намерение оператора = `user`, исполнение/инциденты = `system`;
   - `correlationId`: авто-серия попыток и инцидент связи сворачиваются каждый под один corr.
2. **Резолв имени:** helper с кэшем в `ConnectionManager` (`ResolveLabelAsync`/`ConnLabel`);
   `ConnectionSupervisor` берёт имя через него.
3. **`ConnectionSupervisor`:** имя во всех строках; `connected → ok`; `connecting → warning + underway`;
   общий `correlationId` на авто-серию; `schedule_disconnect` с именем.
4. **`ConnectionManager`:** имя в `lost`/`recovered`/`reconnecting` (инцидентная ось
   Open→Progress→Resolve по `LinkIncidentSubject` уже корректна — правится только presentation).
5. **Каталог рантайм-NC** — [auto-connect.md](auto-connect.md) §5; перекрёстная ссылка из
   [error-handling.md](error-handling.md) (единый каталог NC фазы).
6. **Инфра-ошибки авто-connect:** ретраи не глотают исключение молча; после исчерпания попыток —
   `connect_failed` (error) в NC (свериться/закрепить); необработанное — `GlobalExceptionHandler` (7j.17).
7. **Тесты/приёмка:** synthetic → живой прогон на Finam id=3 (анти-DDoS: реальный Finam не ронять
   tight-loop / в выходные).

### Вне области (7j.18)

- Персист кредов для ночного Auto (отдельно).
- Полный phase 11.2 (user-actions/фильтры сверх connection-кодов).
- Market/calendar profile (7j.15), `date`-авторинг (7j.16).

### Критерии приёмки (7j.18)

| # | Сценарий | Ожидаемая лента NC |
|---|----------|--------------------|
| 1 | Окно наступило, connect с 1-й попытки | `connecting`(warning) → `connected`(ok), один corr, имя во всех |
| 2 | Авто-connect: 2 фейла + успех | `connecting` ×3 (warning) → `connected`(ok), один corr |
| 3 | Авто-connect: исчерпаны попытки | `connecting` ×max → `connect_failed`(error), один corr |
| 4 | Вне окна / non-trading | `schedule_disconnect`(info) с именем |
| 5 | Обрыв во время окна | `lost`(error, Open) → `reconnecting`(warning, Progress) → `recovered`(ok, Resolve), один инцидент-corr |
| 6 | Ручной connect (регресс) | без изменений (эталон не задет) |
| 7 | Сборка/тесты | `dotnet build` solution + тесты зелёные |

## Завершено — 7j.19: Инциденты связи и точность разрыва

Диагностика и решения — [issue.md](issue.md) (выявлено на живой приёмке 7j.18, Finam id=3, 23.07.2026).

> **Статус (2026-07-26):** I1–I5 в коде; коммиты `22cd62d` (I1–I4), `68151e0` (I5). Миграция **V026**
> применена в рабочем контуре. **Отступление I3:** `gapEnd` = момент `Live` реконнекта, не первой сделки
> (см. [issue.md](issue.md) §I3).

### Цель

Довести инцидентную ось связи до продакшн-уровня для **потоковой записи**: любой разрыв данных
фиксируется точно (границы по меткам сделок), инцидент корректно закрывается, длительность перерыва
видна, а плановое отключение не путается с ручным.

### Область (I1–I4)

1. **I1 — причина закрытия `Scheduled`** *(миграция)*. Добавить `LinkCloseReason.Scheduled`; прокинуть
   `DisconnectAsync(reason)`; авто-путь супервизора при плановом гашении передаёт `Scheduled`. Фронт-легенда
   ленты Connection + `LinkCloseReasonText` — новая подпись «плановое отключение по расписанию».
2. **I2 — идемпотентный `recovered`**. В `HandleLinkStateAsync` на `Live` закрывать инцидент связи
   `Resolve`-ом **без завязки на in-memory `recovering`** (no-op, если инцидента нет). Ре-подписку
   (`OnLinkLiveAsync`) оставить под `recovering`. Устраняет зависший инцидент после реконнекта супервизора
   (тот стирает `_linkStates` в `DisconnectAsync`).
3. **I3 — watchdog по непрерывности сделок** *(ядро задачи)*.
   - «Активность» = входящие сделки (`_lastData`); keepalive и `server_status` таймер тишины не сбрасывают.
   - Порог `T = 15 c` (агрегация сделок 30 c ⇒ 30/2). Тик — существующий probe 15 c.
   - Тишина `> T` в торговом окне → активный `ProbeAsync`: пинг не прошёл ⇒ `lost`(error) с
     `gapStart = lastTradeAt`; пинг прошёл ⇒ тихий рынок (без инцидента).
   - Интервал `link_liveness` закрывать по `lastTradeAt` (честная дырка = data-gap).
   - Восстановление (первая сделка) ⇒ `recovered` с длительностью: заголовок «связь восстановлена»,
     expanded «Перерыв 00:00:43 (… → … МСК)», `data.gapStart/gapEnd/gapMs`.
4. **I4 — `connected`: чистый заголовок + детали в expanded** (оба пути: ручной `OhsEndpoints /connect`
   и авто `ConnectionSupervisor`). Заголовок «связь установлена.»; «Предыдущее подключение…»,
   «Пред. сеанс — <причина>…» — в `data.lines`.

### Порядок работ

1. **I1 (миграция первой):** `LinkCloseReason.Scheduled` + DbUp-скрипт + `LinkLivenessStore` + сигнатура
   `DisconnectAsync(reason)` + вызовы (супервизор Scheduled, ручной Disconnected) + фронт-легенда.
2. **I2:** идемпотентный `Resolve` на `Live` — маленький локальный фикс, разблокирует корректный `recovered`.
3. **I4:** presentation `connected` (оба пути) — переиспуёт `DescribePreviousConnectionAsync` (строки вместо суффикса).
4. **I3:** watchdog в `LivenessProbe.TickAsync` + границы по `lastTradeAt`/`firstTradeAt` + длительность на `recovered`.
5. `dotnet build` solution + тесты; живой прогон на Finam id=3.

### Вне области (7j.19)

- Инжест котировок как «активности» (пока только сделки; появятся котировки — расширим).
- Настройка `T`/порогов через UI (значение фиксировано в коде/конфиге).
- Market/calendar profile (7j.15), `date`-авторинг (7j.16).

### Критерии приёмки (7j.19)

| # | Сценарий | Ожидаемая лента NC / журнал |
|---|----------|------------------------------|
| 1 | Плановое отключение по авто-окну | `schedule_disconnect`(info); `link_liveness` закрыт причиной `Scheduled`, «пред. сеанс — плановое отключение по расписанию» |
| 2 | Обрыв + реконнект супервизора | `lost`(error, Open) → `reconnecting`(warning) → **`recovered`(ok, Resolve)** — инцидент закрыт, не висит |
| 3 | Короткий разрыв данных (~30–40 c), пинг не прошёл | `lost`(error) с `gapStart = lastTradeAt`; на первой сделке — `recovered` с длительностью перерыва |
| 4 | Тихий рынок (сделок нет, пинг ок) | инцидента НЕТ; журнал `link_liveness` не рвётся |
| 5 | `recovered` в expanded | «Перерыв HH:MM:SS (from → to МСК)», `data.gapMs` заполнен |
| 6 | `connected` (ручной и авто) | заголовок «связь установлена.»; детали пред. подключения/сеанса — в expanded |
| 7 | Регресс ленты Connection (7h.8) | честные дырки совпадают с data-gap; цвет/подпись `Scheduled` корректны |
| 8 | Сборка/тесты | `dotnet build` solution + тесты зелёные |

## Завершено — 7j.20: Инциденты связи v2 + backend-outage + system NC JSON

Полная спецификация — [incident.md](incident.md) · [nc-availability.md](nc-availability.md).
Коммиты: `5ffc58c`…`3c1c267` (J1–J8), `8bdfc6c` (backend-outage v2), `fd3e93e` (system → JSON).
Остаток вне connection-scope: **H1/H2** (recording-ribbon) → 7h.

### Зачем (что не так в 7j.19)

Инцидент открывается только на `server_status` `Down`/`Error` или стелс-разрыве. **`Degraded`**
(`recover="true"` — TRANSAQ сам чинит линк) трактуется как «живой» → короткий обрыв `Live→Degraded→Live`
проходит **мимо журнала** (ни NC, ни дырки), хотя данных в этот период нет. Плюс severity инцидента путала
«жив ли процесс» с «потеряны ли данные».

### Идея (модель)

- **Один бит здоровья:** `Live` = ок, любой уход (`Degraded`/`Down`/`Error`/стелс) = инцидент (0 c, без
  порогов). Возврат в `Live` = закрытие.
- **Две оси:** **severity = удар по данным** (любой обрыв в окне = `error`); **owner = кто чинит**
  (`TRANSAQ` сам через `recover` → или `supervisor` перехватывает через `t`).
- **Владение и передача:** `Degraded` → owner=TRANSAQ (сессию не рвём); если не вернулись в `Live` за
  `t` (`LinkRecoverGraceSeconds`, дефолт 60 c) → супервизор форс-гасит и берёт владение (`connect ×5`);
  один инцидент на всё событие.
- **Хранение:** журнал уже есть (`link_liveness` + NC); новую таблицу не заводим.
- **Визуализация:** connection-ribbon — красный маркер-старт (1px) + жёлтое тело TRANSAQ / красное тело
  supervisor + зелёный маркер-конец (1px). Recording-ribbon (7h) — сплошной красный, бинарно.

### Область — scope 7j (connection: инциденты, NC, ribbon)

- **J1. `Degraded` = инцидент.** `HandleLinkStateAsync`: `Degraded` из ветки «живой» → путь открытия
  инцидента (severity **error**, owner=TRANSAQ). Сегменты/подписки **не** рвём, keepalive живёт;
  `recovered` — только на настоящем `Live`.
- **J2. Один бит здоровья.** Открытие на любом уходе из `Live`, закрытие на возврате; свести
  server_status / стелс / supervisor к единому open/close по `_incidentSince`.
- **J3. Owner + handover.** Поле `owner` (`transaq`|`supervisor`); таймер `t`; по истечении в `Degraded` —
  супервизор форс-гасит сессию **особой причиной** (инцидент не закрывать) и берёт владение.
- **J4. NC-коды.** `connection.lost`(error/active) → `connection.recovering`(TRANSAQ, underway) /
  `connection.reconnecting`(supervisor, underway) → `connection.recovered`(ok/resolved, expanded: кем +
  границы + длительность). Дедуп только по одному открытому инциденту, порогов нет.
- **J5. Прогресс-тик.** Наш таймер (супервизор) шлёт `recovering`/`reconnecting` с elapsed/попыткой, пока
  инцидент открыт (TRANSAQ повторные `recover` схлопывает — прогресс гоним сами).
- **J6. Хранение handover.** Персистить момент/владельца передачи (два gap-сегмента vs timestamp owner —
  решить) для рендера тела ленты и expanded.
- **J7. Connection-ribbon v2.** Красный маркер-старт (1px) + зелёный маркер-конец (**1px**, было 2px);
  тело по owner (жёлтое TRANSAQ / красное supervisor); серое без маркеров для `disconnected`/`scheduled`.
- **J8. Конфиг.** `LinkRecoverGraceSeconds` (дефолт 60) в `OhsOptions`/`appsettings`.

### Смежная область — scope 7h (данные / запись)

- **H1.** `Degraded` = дыра в записи: recording-путь (`capture_liveness`/`CoverageTrack`) даёт **красное** и
  на `Degraded` (сейчас «живой»).
- **H2.** Recording-ribbon — бинарный сплошной красный (`[blue][red][blue]`), без причин/владельцев.
- **H3.** ~~(DEFERRED)~~ **DONE** (2026-08-03) — 3-мин старт данных: cache-first + суточная
  инвалидация / Refresh + фоновый batch persist —
  [../phase7h/startup-latency.md](../phase7h/startup-latency.md) (приёмка Finam: ~10–16 с).

### Порядок работ

1. **J1 + J2 (ядро):** `Degraded` → инцидент (error), единый один-бит open/close. Даёт «любой обрыв
   ловится» сразу, без владения. Разблокирует живую проверку «Degraded → красный след в NC».
2. **J4 + J5:** NC-коды `recovering`/эскалация + прогресс-тик (severity/owner в данных сообщения).
3. **J3 + J6 + J8:** owner + handover через `t` + персист перехода + конфиг.
4. **J7:** connection-ribbon v2 (маркеры 1px, тело по owner).
5. **H1 + H2:** recording-путь (Degraded=красное, бинарная лента).
6. `dotnet build` solution + unit/vitest; живой прогон на Finam id=3 (выдёргивание VPN).

### Вне области (7j.20)

- Attempt-level детализация ретраев самого TRANSAQ (чёрный ящик DLL — недоступно).
- Настройка `t`/severity через UI (значения в коде/конфиге).
- 3-мин старт данных (7h, deferred), market/`date`-авторинг (7j.15/16).

### Критерии приёмки (7j.20)

| # | Сценарий | Ожидаемо |
|---|----------|----------|
| 1 | `Live→Degraded→Live` (TRANSAQ сам, ≤ `t`) | инцидент открыт (`lost` error) + `recovered`(ok) «средствами TRANSAQ»; на ленте красный маркер + жёлтое тело + зелёный маркер |
| 2 | `Degraded` дольше `t` (60 c) | передача владения: force-disconnect (инцидент **не** закрыт) → `reconnecting` supervisor → `recovered` «супервизором»; тело жёлтое→красное |
| 3 | Сразу `Down` (без Degraded) | owner=supervisor с 0 c; красное тело, красный/зелёный маркеры |
| 4 | Суперкороткий обрыв (1–5 c) | **есть** пара open→recovered в NC и дырка в `link_liveness` (не теряется) |
| 5 | `connect ×5` не удались | инцидент **остаётся открыт** (`connect_failed`), owner=supervisor, до окна/оператора |
| 6 | NC-скан оператором | у каждого инцидента красная строка открытия = «здесь теряли данные» |
| 7 | Recording-ribbon (7h) | сплошной красный на всём инциденте (вкл. Degraded), без причин |
| 8 | Сборка/тесты | `dotnet build` solution + unit/vitest зелёные |

## Бэклог (после 7j.20)

- **WS-хартбит — детект зависшего (не упавшего) бэка.** Сейчас недоступность ловится по обрыву WS
  (`onDrop`). Если бэк **завис** (дедлок; под отладчиком — пауза на unhandled), сокет **не рвётся**: данные
  не идут, но фронт «зелёный» и инцидент простоя не открывается. Ловится только keepalive-хартбитом: бэк
  шлёт периодический тик по WS, клиент при отсутствии N тиков (порог) считает бэк недоступным и открывает
  инцидент простоя (та же стейт-машина). Реальная дыра (не только под отладчиком) — см. `nc-availability.md`.
- **Единый инцидент здоровья бэка (два триггера открытия).** Открытие инцидента не только по обрыву WS, но
  и по `ohs.unhandled` (500) при отсутствии открытого инцидента (иначе — фолд, как сейчас), с общим
  закрытием по settle. Убирает «fatal-in-fatal» и висячий одиночный FATAL. Трекается отдельно.

## Критерии приёмки фазы

1. Auto + утверждённое расписание → connect в окне / disconnect вне; в non-trading днях ведущего
   `engine` связь по Auto не поднимается.
2. Ручной disconnect тумблера → Auto off; ручной connect при Auto off работает без расписания.
3. Auto без живых правил включить нельзя.
4. Правка расписания → атомарно (Saga, 7j.17): всё-или-ничего, без частичной записи; на сбое —
   попап остаётся с баннером + Retry, в NC — error.
5. После N неудачных Connect — `connect_failed` (error) в NC; Finam не долбится tight-loop / в выходные.
6. **Все lifecycle-события и инциденты связи видны в NC в едином стандарте** (имя, severity,
   группировка) — 7j.18.
7. `tsc` + vitest + backend-тесты + `dotnet build` solution зелёные.

## Зафиксированные решения

1. **`engine`:** один ведущий календарь, без join.
2. **Креды:** MVP Local; персист — отдельно.
3. **UI:** тумблер связи не двигаем; Auto в панели Связь управляет им.
4. **Auto без расписания:** запрещён.
5. **Notify:** тонкий hub в 7j (Publish + инцидентная ось); полный 11.2 — перспектива.
6. **Retry:** пауза ~8 с между попытками, ×5.
7. **История правил:** SCD-2; опечатка → новый пуш + note.
8. **Именование NC:** `Подключение/Расписание {id} («{name}»)` — id первичен; в системных — только id.
9. **Severity по смыслу перехода:** позитивный переход = `ok`; в процессе = `warning`; сбой =
   `error`/`critical`.
10. **Атомарность правок:** редактирование расписания — атомарный `batch` (Saga), без частичной записи.
11. **Safety-net:** глобальный `IExceptionHandler` → `ohs.unhandled` (system·critical).
12. **Оптимизм в UI:** попап расписания не закрывается на сбое (баннер + «Повторить»).
13. **Плановое отключение ≠ ручное:** отдельная причина `LinkCloseReason.Scheduled` (7j.19/I1).
14. **Закрытие инцидента связи — идемпотентно:** `recovered` на `Live` не завязан на in-memory
    `recovering` (7j.19/I2).
15. **Непрерывность = сделки:** «активность» = входящие сделки; `T = 15 c` (агрегация 30 c / 2);
    границы разрыва по `lastTradeAt`/`firstTradeAt`; тихий рынок отсекается активным пингом; разрыв
    подтверждается провалом пинга → `lost`(error) (7j.19/I3).
16. **Один бит здоровья (7j.20):** здоровье = `Live`; любой уход (`Degraded`/`Down`/`Error`/стелс) =
    инцидент с 0 c, без порогов детекции; возврат в `Live` = закрытие. `Degraded` — тоже инцидент.
17. **Severity ≠ owner (7j.20):** severity = удар по данным (любой обрыв в окне = **error**); owner = кто
    восстанавливает (`TRANSAQ` через `recover` → или `supervisor` через `t`). Это разные оси.
18. **Передача владения (7j.20):** TRANSAQ владеет `Degraded` `t` = `LinkRecoverGraceSeconds` (дефолт
    60 c); дальше супервизор форс-гасит сессию особой причиной (инцидент **не** закрывается) и берёт
    владение. Один инцидент на всё событие.
19. **Лента vs NC (7j.20):** connection-ribbon кодирует причину/владельца (маркеры 1px + тело жёлтое
    TRANSAQ / красное supervisor); recording-ribbon (7h) — бинарный сплошной красный «данные есть/нет».
