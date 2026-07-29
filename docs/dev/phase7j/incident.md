# Phase 7j — Инциденты: модель, владение, хранение, визуализация

Статус: **J1–J8 + J11a/b/c + I10 + I11 КОД ГОТОВ** · живая приёмка I11 · **H1/H2 DONE**.
Модель 2026-07-24; горизонт/исходы/виды 2026-07-26; abandon schedule (break+crash) 2026-07-26…27;
I10 — 2026-07-27.
Живая приёмка части сценариев на Finam id=3. Данные/запись — 7h ([../phase7h/incident.md](../phase7h/incident.md)).
Обновлено: 2026-07-27.

Связано: [auto-connect.md](auto-connect.md), [issue.md](issue.md) (I1–I10),
[nc-availability.md](nc-availability.md) (вид **`crash`** / Host Unavailable), [v2-exceptions.md](v2-exceptions.md)
(якорь расписания).

---

## 0a. Терминология: виды инцидентов (закреплено)

Два вида (id — **lowercase**). Не путать с **owner** (кто чинит) и **sender** (кто послал строку в NC).

```text
Инциденты
│
├── break  — обрыв связи (к бирже / коннектору)
│   ├── degraded   (owner = connector / transaq)
│   └── down       (owner = supervisor)
│
└── crash  — падение / авария нашего контура (owner = admin)
    ├── host_unavailable   — stop / restart Host (WS down)     ← реализовано
    ├── exception_500      — необработанное исключение         ← вход в открытый crash (тот же corr)
    ├── out_of_memory      — затравка (детектора пока нет)
    └── out_of_disk        — затравка (детектора пока нет)
```

| Вид (id) | Русское | Контур | Owner (кто чинит) | Лента | NC (сейчас) |
|----------|---------|--------|-------------------|-------|-------------|
| **`break`** | обрыв связи | Finam ──①── TRANSAQ ──②── OHS | `connector`/`transaq` → `supervisor` | жёлтое / красное **сплошное** | `connection.*` |
| **`crash`** | падение / авария | client ↔ OHS Host | **`admin`** | красная **штриховка** | `backend.*` / fold `ohs.unhandled` |

### `break` — фазы одного вида (не два вида)

Топология плеч — §3. Один инцидент, один corr; owner может смениться:

| Фаза | Плечо | Owner | Тело | Сигнал |
|------|-------|-------|------|--------|
| `degraded` | ① | `connector` (`transaq`) | жёлтое | `Degraded` / recover |
| `down` | ② | `supervisor` | красное сплошное | `Down` / `Error` / `ping_failed` / после handover |

`degraded`→`down` = handover / эскалация; `escalatedAt` только для раскраски.

### `crash` — подтипы одной нити

- **`host_unavailable`** — фронт детектит по живости WS (`sender=client`), persist задним числом;
  геометрия — `interrupted` ([nc-availability.md](nc-availability.md)).
- **`exception_500`** — на dev сам по себе не открывает новый crash; если crash уже открыт —
  входит **в тот же corr** (saga: много входов → один итоговое close). Иначе — health-probe /
  adopt (см. nc-availability §9).
- **`out_of_memory` / `out_of_disk`** — задел подтипов, детекторов пока нет.

Инвариант стека (оба вида): **много входов — один выход**; повторные удары в открытый инцидент
не плодят новый corr.

Плановый `scheduled` / ручной `disconnected` — **не** инцидент (серое).

---

## 0. Зачем это (проблема действующего подхода)

Сейчас «инцидент» размазан по нескольким детекторам с разными порогами, и **короткие обрывы не ловятся**:

- Инцидент (`connection.lost`) открывается **только** на `server_status` `Down`/`Error` или на стелс-разрыве
  (stall-watchdog: тишина сделок ≥15 c + непрошедший пинг, и только во время записи).
- **`Degraded`** (`connected="true" recover="true"` — TRANSAQ сам восстанавливает линк) трактуется как
  **живое** состояние: keepalive идёт, инцидент **не** открывается. Тумблер жёлтый «Восстановление…»,
  супервизор не вмешивается (`degraded` считается «подключён»).
- Итог: `Live → Degraded → Live` (короткий обрыв, который TRANSAQ залатал сам) проходит **мимо журнала** —
  ни NC, ни дырки. А это дыра в данных.

Нужна **простая прозрачная модель**: любой обрыв — даже суперкороткий — это инцидент с открытием и
закрытием, видимый в NC и на ленте.

---

## 1. Принцип (один бит здоровья)

**Baseline (инвариант):** пока окно расписания соединения говорит «должны быть на связи», здоровое
состояние ровно одно — **`Live`** (подключены). Всё остальное — инцидент.

> **Инцидент вида `break` = любой интервал, когда связь НЕ в состоянии `Live`, внутри окна «должны
> быть подключены».**

Один бит: `UP` (=`Live`) или `DOWN` (`Degraded` / `Down` / `Error` / реконнект / стелс). Ушли из `Live` —
инцидент **открылся** (0 c, без порога). Вернулись в `Live` — исход `recovered` (зелёный маркер). Даже
1-секундный `Degraded` даёт честную пару open→recovered. Иные исходы закрытия — §1.1 / §1.2.

**Никаких порогов детекции и «коротких/длинных».** Единственная временна́я величина в модели — `t`
(дедлайн передачи владения, §3), и это **не** порог детекции: инцидент уже открыт с 0 c.

Вне окна расписания связь гасится планово (`scheduled`, серое) — это **не** инцидент. Инцидент в
нерабочее время = обычное уведомление, **не** инцидент в смысле этой модели.

### 1.1. Горизонт = расписание соединения (не «календарные сутки»)

**Якорь конца рабочего окна — всегда расписание этого коннектора** (тот же артефакт, по которому Auto
включает/выключает тумблер). Auto — лишь исполнитель; расписание — **неотъемлемый атрибут** соединения.

- **Empty (расписание не установлено):** единственный дефолт — окно **00:00–24:00** в TZ расписания.
  Это не «всегда так», а fallback при отсутствии правил.
- **Если расписание задано** — окно живёт по якорной модели **`start-time` + `duration`**,
  инвариант **`duration < 24 ч`** ([v2-exceptions.md](v2-exceptions.md)). Окно **может пересекать
  полночь** (овернайт): `06:00` + duration до `02:00` следующих суток — норма, `24:00` не особая точка.
- **Наслоение максимум одно** (хвост вчерашнего овернайта ∩ окно нового дня) — в коде отдельной
  «склейки» нет: `IsConnectDesired` = OR окон `{вчера, сегодня}` → непрерывный `desired=true`:

```text
день D:     06:00---------------------------------02:00TM
день D+1:                                       00:00TM--------------------------19:00TM
наложение:                                      00:00TM--02:00TM
факт (desired): 06:00-------------------------------------------------------------19:00TM
                                                    ↑                         ↑
                                              не close                   истинный close
```

  (`TM` = следующие календарные сутки относительно дня D.)

| Момент | Окно дня D | Окно D+1 | `desired` | Disconnect / closing-warn / обрез ленты? |
|--------|------------|----------|-----------|------------------------------------------|
| `00:00TM` | да (хвост) | да (старт) | **true** | нет (Auto «включить» — тумблер уже on → no-op) |
| **`02:00TM`** | кончилось | да | **true** | **нет** — конец якоря D, но union ещё жив |
| **`19:00TM`** | нет | кончилось | **false** | **да** — спад `desired true→false` = истинный close |

- **Горизонт инцидента / `abandoned_schedule`** = спад `desired` (в примере — **`19:00TM`**), **не**
  конец якоря дня D (`02:00TM`). Warn + обрыв ленты только там; на стыке хвоста при overlap — тишина.
- Слои `main` / `dow` / `date` + календарь engine — внутри резолвера. Не путать с концом торговой
  сессии MOEX.

Тело инцидента **не** тянется за пределы текущего desired-интервала. Если между окнами есть
разрыв (`desired=false` — ночь/день без connect по расписанию), на спаде уже сработал
`abandoned_schedule` (warn + обрыв ленты); красное **не** тянем через этот разрыв до утреннего
boot или следующего окна. (Овернайт с overlap — не «пустой»: там `desired` остаётся true.)

### 1.2. Три исхода закрытия (лента + NC)

| Исход | Когда | Правый край ленты | Зелёный 1px | NC |
|-------|--------|-------------------|-------------|-----|
| **`recovered`** | снова `Live` / успешный connect | `t_ok` | **да** | `connection.recovered` · ok |
| **`abandoned_schedule`** | спад `desired` при открытом **`break`** | `t_end` (маркер `scheduled`, `Abandoned`) | **нет** | `connection.incident_closed` · **warning** · resolved (см. ниже) |
| **`abandoned_manual`** | ручной off / Auto off при открытом инциденте | `t_stop` (маркер `disconnected`, `Abandoned`) | **нет** | `connection.incident_closed` · **warning** · resolved (`reason=manual_off`) |

**NC timeout-close для `break` (реализовано):** супервизор на `desired true→false` →
`TryAbandonIncidentByScheduleAsync`:

- message: `Подключение N («…»): инцидент закрыт по окончании окна расписания`
- code `connection.incident_closed`, severity **warning**, status **resolved**, тот же corr
- data: `{ connectionId, kind: "break", reason: "schedule_end", sender: "supervisor", result: "…" }`
- без открытого break — по-прежнему info `connection.schedule_disconnect`

Визуальный контракт:

```text
recovered:     |red [yellow|red body] green|
abandoned:     |red [yellow|red body]      |   ← обрыв без green («не успели»)
               ↑ open                      ↑ schedule end / manual
```

Пример: обрыв за час до конца окна, grace супервизора 2 ч → двухфазная лента (жёлтая→красная) тянется
**до `t_end` окна**, затем обрыв без green. То же для backend-outage (штриховка) и для `interrupted`:
клип к концу окна того дня, не «до следующего старта процесса».

**Реализация обрыва ленты (J11):** правый край без «восстановления» — **liveness-маркер**
(тот же приём, что handover J6: нулевой closed-интервал в `t_end` с `Abandoned` / `scheduled`),
чтобы `QueryGapsAsync` дал конечный `To` и фронт не рисовал green.

- **J11a `break`:** `TryAbandonIncidentByScheduleAsync` + NC `connection.incident_closed` — **DONE**
  (`368bfb9`).
- **J11c `crash`:** клиент `abandonBackendOutageBySchedule` + Host `MarkCrashAbandonedByScheduleAsync`
  (Release + ribbon) + optimistic `overlayCrashOutageOnLink` — **КОД ГОТОВ** (working tree 2026-07-27).
- **J11b `abandoned_manual`:** `CloseBreakAsync(abandoned_manual)` / `TryAbandonIncidentByManualAsync`
  (I11 B1) — **КОД ГОТОВ** (2026-07-28).

### 1.3. Утро / рестарт бэка

Вчерашний день **не продолжаем** одной нитью через ночь:

1. Startup-recovery по-прежнему закрывает осиротевшие интервалы (`interrupted` на последнем keepalive) —
   геометрия вчерашнего дня; **не** растягиваем красное до `now`.
2. Если был простой бэка — одно system-уведомление вроде «сервер OHS снова доступен» (без реанимации
   вчерашнего corr-стека). Разбор «всех вчерашних незакрытых» утром не обязателен: горизонт уже обрезан
   исходом `abandoned_*` на конце окна.
3. Правило стека (как в коде сейчас): **входов/ударов может быть несколько, но они идут в один corr**
   открытого инцидента (повторный open по тому же subject — no-op / fold; backend-outage — adopt corr /
   `foldUnhandledIntoOutage`). Новый день / новое окно → при сбое открывается **новый** инцидент (новый
   corr), а не продолжение вчерашнего.
4. Порядок утра: recovery геометрии → (опц.) «жив» в NC → затем Auto/connect по расписанию. Если с утра
   снова плохо — заводим новый инцидент штатно.

**Рестарт / crash Host внутри того же окна `desired`** — другой случай: open break мог остаться
в audit без terminal (память Hub сброшена), а супервизор после оживления чеканит новый `auto:`-corr.
В Thread это выглядит как `break OPEN` + `crash` + отдельный **Group** восстановления — см. **I10**
([issue.md](issue.md)#i10-после-crashрестарта-host-open-break-остаётся-active-восстановление-уходит-в-новый-group-auto).

Правило после оживления (после ingest crash-пачки):

```text
desired?
  НЕТ → если в БД есть open link-corr → catch-up abandoned_schedule; connect не запускать
  ДА  → если в БД есть open link-corr → adopt: connecting…recovered в ЭТОТ corr
        иначе → auto-corr как сейчас (чистый kickoff)
```

Источник open break — V025 (`connection:{id}:link:*` без terminal), не in-memory `_openIncidents`.
Crash-corr не сливать с link-corr; вложенность только по времени.

---

## 2. Оси: severity · owner · sender (не путать с видом)

Вид инцидента — §0a (`break` | `crash`). Внутри строки NC / фазы ещё три оси:

| Ось | Отвечает на | Примеры |
|-----|-------------|---------|
| **Severity** | насколько серьёзно | `break` open = **error**; `crash` / host_unavailable open = **critical** |
| **Owner** | кто **чинит** | `break`: `connector`/`transaq` · `supervisor`; `crash`: **`admin`** |
| **Sender** | кто **отправил** строку в NC | `transaq` · `supervisor` · `backend` · `client` (фронт) |

Не путать owner и sender: при `break` owner может быть `transaq`, а progress-тик шлёт `supervisor`.
При `crash` / host_unavailable sender строк = **`client`**, owner восстановления = **`admin`**.

Ключевое следствие: **`Degraded`, которым владеет TRANSAQ, — всё равно `error`** (дыра в данных уже идёт).
Владелец говорит «кто чинит», severity — «сколько потеряли».

**Правило severity (вариант A, согласовано):** любой обрыв внутри окна «должны быть на связи» = **error**,
без исключений (не различаем «а были ли реально сделки в этот момент»). Прозрачно и предсказуемо. По
построению инцидент всегда внутри окна (вне окна — плановый `scheduled`-disconnect, не инцидент).

---

## 3. Владение и решение инцидента (ownership + handover)

Один инцидент на всё событие; владелец меняется по ходу. `T` = **дедлайн передачи владения**
(конфиг `LinkRecoverGraceSeconds`, дефолт **60 c**).

**Инвариант ленты Connection:** жёлтое (owner TRANSAQ) длится **`t ≤ T`**, где T =
`LinkRecoverGraceSeconds` — **максимум**, не фиксированная длина.
- Degraded→Down / Error раньше grace → `escalatedAt = t < T` (сдал раньше).
- grace без Live → `escalatedAt = since+T`.
- Live до T → `escalatedAt=null`, жёлтое короче T (норма).
Gap &gt; T без маркера — дефект; Host catch-up на close → boundary `since+T`; UI clamp потолком T
(`linkRecoverGraceSeconds` в `/coverage/link`).

### Плечи (топология)

```text
Finam server ──①── TRANSAQ (коннектор/DLL) ──②── OHS (host)
```

- **Плечо ①** (провайдер ↔ коннектор): линк к Finam. Первичный владелец восстановления — **TRANSAQ**
  (его встроенный авто-recover, `recover="true"`).
- **Плечо ②** (коннектор ↔ наш процесс/сессия): подъём/держание сессии. Владелец — **супервизор**
  (`connect ×5`). Падение самого Host — вид **`crash`**, не фаза `break` (§0a).

### Жизненный цикл

```text
[Live] ── уход из Live ──▶ ИНЦИДЕНT ОТКРЫТ (error, active)
   │
   ├── вошли в Degraded (recover) ─────────▶ owner = TRANSAQ
   │      • тик-прогресс каждые ~15 c: «восстановление (TRANSAQ) · Nс» (underway)
   │      • сессию/подписки/сегменты НЕ трогаем (TRANSAQ держит connected=true)
   │      ├── вернулись в Live ≤ t ─────────▶ recovered (ok): «восстановлена средствами TRANSAQ»
   │      ├── TRANSAQ сам сдался Degraded→Down (~30 c, жёсткий обрыв) ─▶ второй open «связь потеряна (Down)»
   │      │      + ПЕРЕДАЧА ВЛАДЕНИЯ супервизору (естественная эскалация, раньше grace-таймера) ▼
   │      └── прошло > t (60 c), всё ещё Degraded ─▶ ПЕРЕДАЧА ВЛАДЕНИЯ по grace:
   │             супервизор форс-гасит залипшую сессию (особой причиной, инцидент НЕ закрывается)
   │             и берёт владение ▼
   │
   ├── вошли сразу в Down/Error/стелс ──────▶ owner = supervisor с 0 c (фазы TRANSAQ нет)
   │
   └──[owner = supervisor]──▶ connect ×5 (пауза 8 c), «восстановление связи, попытка k/5» (underway)
          ├── connect OK ─────────────────▶ recovered (ok): «восстановлена супервизором»
          └── 5/5 fail ───────────────────▶ инцидент ОСТАЁТСЯ ОТКРЫТ (connect_failed),
                                             owner=supervisor, до закрытия окна расписания или оператора
```

Тонкости:
- **Эскалация `Degraded→Down` внутри открытого инцидента даёт ВТОРОЙ `connection.lost` (red, «(Down)»)** —
  осознанно (решение 2026-07-25): `Degraded` и `Down` — разные статусы потери связи, оба видны в нити;
  владелец при этом transaq→supervisor. На практике это **основной путь handover при жёстком обрыве** (~30 c),
  grace-таймер `t` срабатывает лишь если TRANSAQ залип в Degraded, не уходя в Down.
- **`_incidentSince` переживает передисконнект** — при handover инцидент не теряется (уже так устроено, I2).
- Форс-дисконнект при handover идёт **особой причиной** (не благодушный `disconnected`/серый), иначе
  инцидент закроется как «отключено оператором».
- Прогресс-строки гонит **наш таймер** (супервизор тикает 15 c), не TRANSAQ: коннектор схлопывает повторные
  `recover`-статусы (dedup по состоянию в `TransaqConnector.PublishLinkState`), внутри Degraded от него
  тишина. Attempt-level детализация самого TRANSAQ нам **недоступна** (чёрный ящик DLL); мы фиксируем лишь
  **окно** восстановления (длительность) и его исход.

---

## 4. Причины и маппинг в owner-цвет

| Причина (`close_reason`) | Вид / фаза | Owner | Тело ленты | Severity |
|--------------------------|------------|-------|-----------|----------|
| `Degraded` (recover) | **`break`** / `degraded` | connector (`transaq`) | **жёлтое** | error |
| `server_down` / `ping_failed` | **`break`** / `down` | supervisor | **красное сплошное** | error |
| `interrupted` | **`crash`** / `host_unavailable` | admin | **красная штриховка** | critical (NC) |
| `disconnected` / `scheduled` | — | — | **серое** | не инцидент |

Пути `break`: сразу `Down` → красное с 0 c (жёлтой фазы нет); TRANSAQ успел ≤ `t` → только жёлтое;
не успел → жёлтое, затем красное (`degraded`→`down`).

---

## 5. NC-дисциплина

Каждый инцидент = одна нить (`subject = connection:{id}:link`, per-occurrence `correlationId = subject:uid`):

| Фаза | Код | Status | Severity | Пример |
|------|-----|--------|----------|--------|
| Открытие | `connection.lost` | `active` | **error** | «Подключение 3 («Finam»): связь потеряна (Degraded)» |
| Прогресс (TRANSAQ) | `connection.recovering` | `underway` | warning | «восстановление (TRANSAQ) · 45 c» |
| Передача владения | `connection.reconnecting` | `underway` | warning | «TRANSAQ не восстановил за 60 c — переподключаю» |
| Прогресс (supervisor) | `connection.reconnecting` | `underway` | warning | «восстановление связи, попытка 3/5» |
| Закрытие | `connection.recovered` | `resolved` | **ok** | «связь восстановлена · перерыв 00:01:34» (+ expanded: кем и границы обрыва) |
| Провал | `connection.connect_failed` | (open) | error | «не удалось подключить за 5 попыток» |

- **«Красное = потеря данных»** обеспечено красной строкой открытия у **каждого** инцидента. Оператор
  листает NC и по красному видит все обрывы; underway-строки (жёлтые) — лишь ход восстановления.
- **Дедуп** только схлопывает повторные тики **одного открытого** инцидента (не даёт второй `open`).
  Никогда не роняет отдельный инцидент и **не** вводит порог по длительности.
- **Expanded у recovered:** способ восстановления (TRANSAQ / супервизор) + границы обрыва (from → to МСК) +
  длительность.

---

## 6. Хранение результатов

**Журнал уже есть — новую таблицу не заводим.** Источник правды — `link_liveness` (7h.8):

- Каждый **разрыв** между интервалами (`to` закрытого → `from` следующего) = один инцидент, с `close_reason`
  = причина и точными границами. Мелкие обрывы попадают в журнал за счёт закрытия/переоткрытия интервала на
  смене бита здоровья (а не только по keepalive-gap `>45 c`).
- Keepalive / `LinkMaxGap 45 c` остаётся **страховкой от краха** (осиротевший `open` → `interrupted` на
  рестарте), не основным путём.
- Человекочитаемый журнал = **NC** (пара lost→recovered, §5).

### Момент передачи владения: склейка дырок (РЕШЕНО, J6)

Как персистить **момент передачи** (жёлтое→красное внутри одного инцидента) — было (a) два gap-сегмента vs
(b) timestamp владельца. **Выбран гибрид (a) со склейкой на чтении** — так владелец закодирован прямо в
`close_reason` (вариант B из J1: `degraded`=TRANSAQ/жёлтый, `server_down`=supervisor/красный), а НЕ отдельной
колонкой; при этом **простой считается как ОДНА дырка**. Инвариант:

> **Дырка = один инцидент = один непрерывный простой `[start → восстановление]`.** Простой = `To − From`.
> Смена владельца — деталь ВНУТРИ дырки, только для раскраски. Она НЕ дробит дырку и НЕ меняет подсчёт
> простоя. Это критично для сверки «время без связи» ↔ «время без записанных данных».

Механика (важно, легко забыть при рефакторинге ленты/стора):

1. **Вход в `Degraded`** закрывает живой интервал причиной `degraded` → открывается жёлтая дырка (владелец
   TRANSAQ). Keepalive гейтится по `Live`, поэтому дырка не переоткрывается.
2. **Handover по `t`** (супервизор форс-гасит сессию): во время `Degraded` **открытого интервала нет**
   (`CloseAsync` — no-op, закрывать нечего). Поэтому границу владельца ставим явно — **нулевой закрытый
   маркер** `link_liveness [t_handover, t_handover]` с `server_down` (`InsertBoundaryMarkerAsync`). Он не
   значит «связь жива» — только засечка раздела жёлтое→красное.
3. **`QueryGapsAsync` склеивает** соседние сырые дырки, стыкующиеся ВПЛОТНУЮ (`prev.To == next.From` —
   признак нулевого маркера между ними), в **одну** `LinkGap [start, восстановление]`. Первую границу выносит
   в поля `EscalatedAt` / `EscalatedCause` (**только для раскраски**: жёлтое `[From, EscalatedAt]` · красное
   `[EscalatedAt, To]`). Дырки, разделённые РЕАЛЬНЫМ живым интервалом (ненулевым), — разные инциденты, не
   склеиваются.
4. **Нулевой маркер видим в `QueryAsync`** как интервал нулевой ширины (легитимные single-tick интервалы
   тоже нулевые — по геометрии не отличить, поэтому контракт `QueryAsync` НЕ фильтруем). Рендер нулевой
   ширины отсекает фронт (J7). `GetLastAsync` («предыдущее подключение») нулевые маркеры пропускает, чтобы
   контекст оставался осмысленным.

Прочее хранение:

- **Журнал уже есть — новую таблицу не заводим.** Источник правды — `link_liveness` (7h.8). Каждый разрыв
  между интервалами (`to` закрытого → `from` следующего) = один инцидент, с `close_reason` и точными
  границами. Мелкие обрывы попадают в журнал за счёт закрытия/переоткрытия интервала на смене бита здоровья.
- Keepalive / `LinkMaxGap 45 c` остаётся **страховкой от краха** (осиротевший `open` → `interrupted` на
  рестарте), не основным путём.
- Человекочитаемый журнал = **NC** (пара lost→recovered, §5).

---

## 7. Визуализация (две ленты, разные оси)

### Connection-лента (диагностика: где/почему/кто чинит)

```text
recovered:   |red [ yellow: TRANSAQ ][ red: supervisor ] green|
abandoned:   |red [ yellow: TRANSAQ ][ red: supervisor ]      |  ← без green
 ▲             ▲ владелец = TRANSAQ  ▲ владелец = supervisor  ▲
 старт          (сам чинит линк)      (перехватил, connect×5)  recovered → Live
 =error                                                        abandoned → конец окна / manual
```

- **Красный маркер (старт)** — момент открытия инцидента (ошибка, потеря связи).
- **Жёлтое тело** — чинит TRANSAQ сам (плечо ①).
- **Красное тело** — чинит супервизор (плечо ②); если не сможет — тянется до исхода `abandoned_*`
  (конец окна расписания / manual), не через ночь.
- **Зелёный маркер (конец)** — **только** исход `recovered` (возврат в `Live`). При `abandoned_schedule` /
  `abandoned_manual` зелёного **нет** — видно, что до конца окна не починили.
- Маркеры **фикс-ширины 1px**, высокий z-index. Пока зум дискретный (D1/All), короткий инцидент
  схлопывается — **маркеры единственное, что видно**; тело важно на WebGL-зуме позже.
- `disconnected` / `scheduled` (плановый stop без предшествующего инцидента) — серое, **без** цветных
  маркеров (не инцидент).
- **Тултипы маркеров** — короткие (`Потеря связи · HH:mm` / `Связь восстановлена · HH:mm`). Подробности —
  в NC. Клик → corr — §7.1 (перспектива).

Файлы: `web/src/ui/components/ConnectionRibbon.tsx` + `.module.css`.

### 7.1. Перспектива: клик по маркеру → фильтр NC / журнал по `correlationId`

**Статус: FUTURE** — после **phase 11.13** (таблица `incident` в OHS) и удобнее после WebGL /
когда ленту можно растягивать. Не блокирует MVP. Канон «инцидент» — wiki + этот файл; не
[../phase7h/incident.md](../phase7h/incident.md) (SUPERSEDED, только геометрия захвата).

Идея: клик (или double-click) по красному/зелёному 1px-маркеру на Connection-ленте открывает
журнал OHS / фильтр NC по `correlationId` — стек
`lost → recovering/reconnecting → recovered|abandoned` без ручного поиска.
Спека журнала: [../phase11/incident-journal.md](../phase11/incident-journal.md).

Задел:

- в DTO gap / маркер прокинуть `correlationId` (сейчас лента знает только `from/to/cause/escalatedAt`);
- NC: применить corr-фильтр **без сброса** остальных фильтров (уже в [todo.md](todo.md));
- до WebGL клик по 1px на дискретном D1 малополезен — поэтому не делаем сейчас, только контракт.

**Crash внутри break на Connection-ленте** (штриховка поверх сплошного) — проекция «почему», не ось
записи. Если гант показал одну сплошную дыру на весь интервал (как на живом Finam 27.07: supervisor
10:06–11:07), а NC развалил тот же эпизод на break + crash + Group `auto:` — **права геометрия ленты**;
баг в corr-журнале NC → [issue.md](issue.md) **I10**. Довести вложенный crash на ганте не критично
для writer: жёлтый / красный / полосатый для записи без разницы.

### Recording-лента оператора (полнота данных: есть/нет)

Ей **не важно**, из-за чего и чья ответственность — важно только «данные шли или нет».
**To-be источник:** бинарная **проекция** журнала [`incident`](../phase11/incident-journal.md)
(не gaps `link_liveness` / не type break\|crash). Сплошной красный, **без маркеров**, без
owner/escalatedAt; перекрывающиеся эпизоды (в т.ч. crash внутри break) — **merge** в один red.
Детали дыры и восстановление данных — по строкам журнала.

```text
[ blue ][ ─────── red ─────── ][ blue ]
 данные      данных нет          данные
```

As-is файлы: `web/src/ui/components/CoverageTrack.tsx` + `coverageGeometry.ts` (7h).
Канон проекции — [phase11/incident-journal.md](../phase11/incident-journal.md) §3.0b.

---

## 8. Что дорабатываем: scope 7j vs 7h

### Scope 7j — connection (обработка инцидентов, NC, connection ribbon)

- [x] **J1. `Degraded` = инцидент.** В `ConnectionManager.HandleLinkStateAsync` перенести `Degraded` из
  ветки «живой» в путь открытия инцидента (open с severity **error**, owner=TRANSAQ). Сохранить исходную
  пользу Degraded: сегменты/подписки **не** рвём, keepalive живёт. `recovered` — только на настоящем `Live`.
  Хранение: новая `LinkCloseReason.Degraded` + миграция V027 (вариант B).
- [x] **J2. Один бит здоровья.** Инцидент открывается на любом уходе из `Live`, закрывается на возврате в
  `Live`. Свести server_status / стелс / supervisor к единому open/close по `_incidentSince`. Keepalive
  живости связи (`LivenessProbe`) гейтится по `Live` — в Degraded дырку не переоткрываем.
- [x] **J3. Owner + handover.** Владелец (`transaq`|`supervisor`) в `data` строк NC, таймер `t`
  (`LinkRecoverGraceSeconds`=60 c). По истечении `t` в Degraded — супервизор форс-гасит сессию
  (`HandoverToSupervisorAsync`, инцидент НЕ закрывается — `_incidentSince` переживает передисконнект) и
  берёт владение (connect ×5). Handover меняет тело ленты жёлтое→красное (через маркер, см. §6).
- [x] **J4. NC-коды и дисциплина.** `connection.lost`(error/active) → `connection.recovering`(TRANSAQ,
  underway) / `connection.reconnecting`(supervisor, underway) → `connection.recovered`(ok/resolved). Дедуп
  только по одному открытому инциденту, порогов нет. `Progress` сделан повторяемым (`underway→underway`).
- [x] **J5. Прогресс-тик.** Таймер супервизора (15 c) шлёт `recovering`(elapsed) в Degraded и
  `reconnecting`(попытка k/5) в connect-цикле, пока инцидент открыт. Тикает только для auto-подключений.
- [x] **J6. Хранение handover = склейка дырок.** Простой = ОДНА дырка `[start → восстановление]`; момент
  передачи — нулевой маркер `server_down` + склейка в `QueryGapsAsync` → `EscalatedAt`/`EscalatedCause`
  (только для раскраски). Подробно и с инвариантом «одна дырка» — см. §6.
- [x] **J7. Connection-лента.** Красный стартовый маркер (1px) + зелёный конечный (1px); тело по owner
  (жёлтое `[From, EscalatedAt]` = TRANSAQ / красное `[EscalatedAt, To]` = супервизор; `server_down`/
  `ping_failed` сплошной красный, `interrupted` красная штриховка); нулевую ширину интервалов пропускаем;
  серое без маркеров для `disconnected`/`scheduled`. `EscalatedAt` прокинут в DTO `/coverage/link`
  (`CaptureGapDto.escalatedAt`); лента `link$` берёт gaps прямо из API (не из клиентского деривата).
- [x] **J8. Конфиг.** `LinkRecoverGraceSeconds` (дефолт 60 c) в `OhsOptions`/`appsettings` — глобальный
  дефолт (fallback для J9).
- [ ] **J9. Порог `t` — атрибут коннектора, настраивается в Settings (ПЛАН, реализуем позже).**
  Сейчас `t` глобальный (`OhsOptions.LinkRecoverGraceSeconds`). Семантически это политика конкретного
  коннектора (разные брокеры восстанавливаются по-разному) → делаем `t` **атрибутом коннектора** и правим
  из Settings-поповера соединения (шестерёнка, `ProviderCard.tsx`).
  - **Миграция V028:** новая колонка `connector_connection.recover_grace_seconds INT NULL` (NULL =
    использовать глобальный дефолт `OhsOptions.LinkRecoverGraceSeconds`).
  - **Домен/хранилище:** `ConnectionDto` + `IConnectionStore`/`ConnectionStore` (create/update) +
    `/connections` endpoints пробрасывают `recoverGraceSeconds`.
  - **Backend** (`ConnectionSupervisor`): `RecoverGrace` перестаёт быть глобальной — становится функцией
    `connectionId`: читает `recover_grace_seconds` подключения (с кэшем), fallback →
    `options.LinkRecoverGraceSeconds` → 60.
  - **Frontend** (`ProviderCard.tsx`): рядом с секцией «Показывать» в settings-поповере добавить секцию
    **«Установить»** с полем **«Время попыток восстановления, сек»** (числовой `edit`, default `60`),
    сохранение → update коннектора через store/API.
  - **Приёмка:** выставить в UI 120 c — handover не срабатывает раньше; 30 c — срабатывает раньше.
- [ ] **J10. «Порог чувствительности уведомлений, сек» — ГЛОБАЛЬНАЯ настройка в Settings NC (ПЛАН, позже).**
  `LivenessProbeSeconds` (дефолт 10 c) — кадеанс единой петли `LivenessProbe.RunAsync` (keepalive-проба ленты
  Connection + reconcile супервизора + тики recovering/reconnecting). Это **не** свойство коннектора (один цикл
  на всех), поэтому правится **в Settings самого NC**, а не в карточке соединения. Per-connection-вариант
  отвергнут (потребовал бы рефактор на пер-коннекшн таймеры без пользы).
  - **Frontend:** поле **«Порог чувствительности уведомлений, сек»** (`edit`, default `10`) в настройках NC
    (`packages/notification-center` — рядом с `sendToTray`/dock-настройками, `notificationDockStore.settings$`).
  - **Backend:** глобальный store настройки + endpoint get/set; петля `LivenessProbe.RunAsync` должна читать
    интервал **вживую** каждую итерацию (сейчас берёт один раз на старте) + персист (переживать рестарт).
  - **Оговорка для UI:** влияет не только на частоту уведомлений, но и на гранулярность ленты Connection и
    reconcile — по сути «чувствительность детекции». `LinkMaxGap` (45 c) валиден, пока проба ≤ 15 c; при
    бóльших значениях пробы пересмотреть `LinkMaxGap`.
- [x] **J11a. `break` + `abandoned_schedule`** — спад desired → NC warning `connection.incident_closed`
  (`sender=supervisor`, `reason=schedule_end`) + маркер `scheduled` / `Abandoned` (без green).
- [x] **J11c. `crash` + `abandoned_schedule`** — клиент orchestrate close + Host Release/ribbon;
  optimistic Connection overlay на outage. (Закоммитить working tree.)
- [x] **J11b. `abandoned_manual`** — ручной off при открытом break: Manager+Hub close-break
  (`TryAbandonIncidentByManualAsync`). Клик→corr — §7.1 FUTURE.

### Scope 7h — данные / запись (recording-лента, capture)

- [x] **H1. `Degraded` = дыра в записи.** Recording red ← проекция `incident`; capture
  `OnDegradedAsync` / гейт probe — не продлеваем `capture_liveness` в Degraded.
- [x] **H2. Recording-лента = бинарная проекция `incident`.** Сплошной red без маркеров /
  break\|crash / owner; merge overlap (`[blue][red][blue]`). Не путать с Connection-лентой (J7).
  Спека — [../phase11/incident-journal.md](../phase11/incident-journal.md) §3.0b.
- [ ] **H3. (Отдельно, DEFERRED)** 3-мин задержка «первых данных» — см.
  [../phase7h/startup-latency.md](../phase7h/startup-latency.md). Не входит в эту модель.

---

## 9. Открытые вопросы / проверить на живом

1. **Как часто реальный обрыв VPN даёт `Degraded`, а не сразу `Down`.** Влияет на то, случается ли фаза
   TRANSAQ вообще (или почти всегда сразу супервизор). Проверить выдёргиванием VPN по подписи тумблера
   («Восстановление…» = Degraded vs «Подключение…» = connecting).
   **Частично подтверждено (2026-07-24):** живой обрыв Finam ~34 c дал именно `Degraded` (`recover=true`),
   TRANSAQ восстановил сам < 60 c — фаза TRANSAQ реальна, не теоретическая. Нужна ещё статистика по длинным.
   **Подтверждено (2026-07-25)** — два сценария на живом Finam id=3:
   - **VPN off** (мягкий обрыв): `Degraded` → TRANSAQ поднялся сам за ~1 c (ушёл на другую сеть) →
     `recovered` **owner=transaq**.
   - **Выдёргивание кабеля** (жёсткий обрыв): `Degraded` → TRANSAQ **сам сдаётся в `Down` через ~30 c**
     (в наблюдении 42 c: `06:10:29 Degraded → 06:11:11 Down`) → владение **мгновенно** берёт супервизор
     (connect ×5) → `recovered` **owner=supervisor**, разрыв = весь простой (1:43).
   - **Итоговая owner-логика:** `Down` (естественная эскалация из Degraded, ~30 c) **или** `t > 60 c` в
     Degraded ⇒ **owner=supervisor**; возврат в `Live` до этого ⇒ **owner=transaq**. На жёстком обрыве
     handover идёт по эскалации `Degraded→Down` (раньше grace-таймера `t`; сам grace-путь вживую пока не
     проверен). Поток «подключение по расписанию» (auto-серия) сквозь открытый инцидент **не прокрадывается**.
2. ~~**Хранение handover** (§6) — (a) два gap-сегмента vs (b) timestamp владельца.~~ **РЕШЕНО (J6):**
   гибрид (a) со склейкой на чтении — простой = ОДНА дырка, граница владельца в `EscalatedAt` только для
   раскраски. См. §6.
3. Значение `t` по факту (60 c — стартовая гипотеза; подстроить после живых тестов). Постоянное решение —
   `t` как атрибут коннектора, настраиваемый в Settings (см. **J9**).
4. **Детекция сна/hibernate (НЕ входит в модель, обсудить отдельно).** Во сне процесс OHS заморожен: нет
   тиков `LivenessProbe`, нет колбэков `server_status` → инцидент НЕ открывается, а на ленте `link_liveness`
   разрыв > `LinkMaxGap` закроется как `interrupted` только при СЛЕДУЮЩЕМ ударе/рестарте. Итог: «на ганте дыра
   есть, в NC пусто». Чинится отдельным детектором скачка стенных часов/монотонного времени (проснулись →
   зазор > порога → открыть/закрыть инцидент задним числом, причина вроде `suspended`). Наблюдалось вживую на
   Finam id=3.
