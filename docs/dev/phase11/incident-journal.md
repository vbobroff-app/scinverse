# Phase 11 — Журнал инцидентов (11.13)

**Статус:** `DESIGN AGREED` · **11.13a–f DONE** · **H1/J8 DONE** · **I2 RESOLVED** (fan-out).
Журнал OHS v1; запись эпизода — [issue.md](issue.md) **I2** / §7.

**Связано:** [plan.md](plan.md) §11.13 · [issue.md](issue.md) I2 · [to-threads.md](to-threads.md) ·
[persistence.md](persistence.md) · wiki [`incident.md`](../../wiki-readme/incident.md) ·
продюсер [../phase7j/incident.md](../phase7j/incident.md) · handoff [`promt.md`](../../promt.md) §8 ·
**to-be идеология** [`schedule-projection.md`](schedule-projection.md).

**Не путать с phase 7h:** [`../phase7h/incident.md`](../phase7h/incident.md) — SUPERSEDED
как канон платформенного «инцидента». `link_liveness` остаётся слоем **живости**.

---

## 1. Зачем

Лента NC (Thread над V025) — **DONE**. Нужен first-class **журнал инцидентов**:

- одна строка на эпизод (`corr`), без `GROUP BY` по hypertable атомов;
- экран списка + фильтры + ручное resolve;
- **источник верхнего слоя Connection-ribbon** (цветные отрезки + 1px маркеры) вместо
  производных gaps из `link_liveness`.

---

## 2. Продуктовое определение

### 2.0. To-be (канон) — читать первым

> Полная модель: [`schedule-projection.md`](schedule-projection.md) · wiki [`incident.md`](../../wiki-readme/incident.md).

Инцидент = **честный факт** data-affecting сбоя; расписание — **маска / Cutter**, не классификатор.
Journal пишет полный span; NC — всегда Incident; вне окна — void mask, не «нет строки».

### 2.1. As-is (код сейчас; deprecate)

> Инцидент — нарушение работы **во время работы** (горизонт расписания или живой коннектор).  
> Сбой вне горизонта — только уведомление / Group в ленте NC, **не** строка журнала.

| Ситуация | Журнал | Лента NC |
|----------|--------|----------|
| Сбой в горизонте / при живом коннекторе | **да** | Thread Incident |
| Сбой вне горизонта | **нет** | Group / notify |
| Single без corr | нет | Single |

Миграция: [`plan-schedule-projection.md`](plan-schedule-projection.md).

---

## 3. Слои визуализации (две ленты ← один журнал)

Таблица **`incident`** — единственный источник истины по эпизодам. Две **разные проекции**:

### 3.0. Connection-лента (диагностика: где / почему / кто чинит)

Два **независимых слоя** на одной оси (разные таблицы OHS):

| Слой UI | Таблица | Что показывает |
|---------|--------|----------------|
| Лента связи (голубое / pulse / серое idle) | `link_liveness` | Факт link: сессия с брокером готова / нет |
| Инциденты (цвет + 1px маркеры) | `incident` | Эпизоды break/crash |

```text
низ:   link_liveness      — голубые отрезки «link готов» (+ серое disconnected/scheduled)
верх:  incident (journal) — цветные эпизоды + маркеры поверх
         ├── break  (низ подслоя)  — жёлтое / красное сплошное + 1px
         └── crash  (верх подслоя) — красная штриховка + 1px; paint поверх break
```

- Вложенность `crash` ⊆ `break` **не валидируем в схеме** — бэк/клиент уже так открывают;
  UI только красит crash сверху.
- Плановый stop / ручной off **без** предшествующего инцидента — не в журнале
  (серое / отсутствие голубого).
- **Тумблеры** (шестерёнка провайдера → Показывать): «Лента связи», «Инциденты»,
  «Now-маркер», «Панель фильтров».

### 3.0a. Инвариант `ts`: `link_liveness` → NC (не наоборот)

**Link** = сессия коннектора с брокером (`ConnectorLinkState` / TRANSAQ `server_status`),
не запись и не Host.

**Инвариант (DONE в коде, без миграций):** NC **копирует** `ts` источника, не штампует
`UtcNow` в момент `Publish`/`Open`/`Resolve`.

| Путь | Источник `ts` | Куда |
|------|---------------|------|
| Connect OK | `ConnectResult.ReadyAt` (= `Heartbeat` после `OnLinkLiveAsync`) | `link_liveness.from` · NC `connecting`/`connected` · journal Resolve recovered |
| Break lost | `atTs` события (`server_status` / ping) | `link_liveness.to` · journal Open · NC `connection.lost` |
| Recovered / abandon | `IncidentStep.At` | journal Resolve · NC `connection.recovered` / `incident_closed` |
| Recovering ticks | `IncidentStep.At` | NC Progress |

Hub API: опц. `DateTimeOffset? ts` на `Publish` / `Open` / `Progress` / `Append` / `Resolve`
(`null` → `UtcNow` только для операционки без якоря). Fan-out всегда передаёт `step.At`.

Post-factum Group `connection.connecting` после успеха — **не** источник правды (тот же
`ReadyAt`, что у `connected`); кандидат на упрощение `auto:` Group.

**Close / пессимизм:** правый край UP в `link_liveness` (`to_ts`) ≤ факт обрыва; NC terminal
по тому же `atTs` (не позже из‑за Enqueue).

### 3.0b. Recording-лента (полнота данных: шли / не шли)

**Бинарная проекция** того же журнала `incident` (не отдельная таблица причин):

```text
[ blue / данные есть ][ ─────── red ─────── ][ blue ]
                         данных нет
```

| Правило | Решение |
|---------|---------|
| Маркеры 1px (red/green) | **нет** |
| break vs crash / owner / escalatedAt | **нет** — для записи без разницы |
| Перекрывающиеся эпизоды | **merge** в один red-интервал |
| Зачем | показать дыру для восстановления данных; детали — в журнале |

Восстановление данных опирается на границы эпизодов в **`incident`** (или на склеенную
проекцию), не на раскраску Connection-ленты. См. также [phase7j/incident.md](../phase7j/incident.md)
§7 Recording + **H2**.

### 3.1. Реализация (11.13e DONE)

```text
link_liveness  → Connection: голубое (+ серое disconnected/scheduled)
incident       → Connection: break/crash + маркеры (полная семантика)
               → Recording:  бинарный red (merge), без type/owner/маркеров
```

Legacy fallback: если `incidents` ещё не загружены — Connection красит gaps as-is.
Optimistic client crash (J8) — `interrupted` gap, пока в журнале нет пересекающегося crash.

Код: `incidentRibbonProjection.ts`, `ConnectionRibbon.tsx`, `CoverageTrack.tsx`, `OhsStore.refreshLiveness`.

---

## 4. Контракт отрисовки (зафиксировано по текущему UI)

### 4.1. Break

```text
recovered:   |red [ yellow | red body ] green|
abandoned:   |red [ yellow | red body ]      |   ← клип, без green
             ↑ opened_at                      ↑ closed_at
```

| Элемент | Правило |
|---------|---------|
| Красный 1px старт | всегда на `opened_at`; тултип «Потеря связи · HH:mm» |
| Жёлтое тело | owner TRANSAQ: `[opened_at, escalated_at)` или всё тело, если Live до handover |
| Красное сплошное | owner supervisor: `[escalated_at, closed_at??now]` или всё тело, если сразу Down |
| Зелёный 1px | только `close_outcome = recovered` на `closed_at` |
| Клип без green | `abandoned_schedule` / `abandoned_manual`: тело до `closed_at` (конец **desired**-окна / manual), маркера закрытия нет |

Клип — не «календарные сутки», а спад `desired` расписания соединения (или manual off).

### 4.2. Handover break: yellow → 0px → red (as-is механика → to-be поле)

As-is в `link_liveness`:

1. Уход из Live → close `degraded` → жёлтая дыра; открытого UP нет.
2. Handover (grace T или Degraded→Down) → `InsertBoundaryMarkerAsync`: нулевой интервал
   `[t, t]`, `close_reason=server_down` (не «жив», только засечка).
3. `CoalesceOwnerPhases` склеивает стык встык в **одну** дыру; граница → `EscalatedAt`
   (простой = весь `[From, To]`; фаза owner — только раскраска).
4. Маркер `scheduled`/`disconnected` на стыке — **не** handover → `Abandoned=true`.

To-be в журнале: при handover UPDATE `escalated_at`, `owner=supervisor`, `subtype=down`.
Нулевые строки в `link_liveness` для раскраски ribbon **больше не нужны** (могут остаться
для истории живости / recovery).

Потолок жёлтого = T (`LinkRecoverGraceSeconds`); early Down → жёлтое короче T.
Сразу Down → красное с 0 c, `escalated_at = null`.

### 4.3. Crash

| Что | Правило |
|-----|---------|
| Вид | `type=crash`, **один** corr на transport (`ohs.backend.outage:{seed}`); `connection_id = NULL` |
| Scope | `incident_connection (corr_uid, connection_id)` — snapshot enabled на open (P5) |
| Тело | красная **штриховка** на `[opened_at, closed_at??now]` для каждого id ∈ scope |
| Paint | **поверх** break (z-order); вложенность схемой не проверяем |
| Старт 1px | `opened_at` |
| Green | только `recovered` |
| Abandon | `abandoned_manual` → клип без green (UI resolve); schedule-abandon снят (P4) |
| Детект host_unavailable | клиент (дроп WS); оптимистичная геометрия до прихода API |
| Dispatch | **два слоя** (транспорт admin↔OHS + слой соединений) — канон [crash-dispatch.md](crash-dispatch.md) |

> P5 cutover: история NC atoms не мигрируем — purge `notification` + Host restart.
> Legacy `:c{id}` journal на стенде — purge вместе с cutover.

---

## 5. Архитектурные решения

| # | Решение |
|---|---------|
| A1 | **`link_liveness` + `incident` — в OHS Timescale** (геометрия связи / журнал эпизодов). |
| A2 | **Поток уведомлений (atoms / лента Thread) — отдельный сервис NC** (своё репо, свой хост, своя БД). C4 failure domain. |
| A3 | OHS **владеет** журналом инцидентов и **публикует** уведомления в NC (как и другие сервисы). |
| A4 | Front с NC взаимодействует **сам** (MFE); с OHS — **сам** (control-plane / coverage / incidents API). |
| A5 | Одна таблица `incident` (дискриминатор `module`); v1 — `module=connection`. |
| A6 | В журнале **только Incident** (не Group, не Single). |
| A7 | Одна строка = один `corr_uid` = один эпизод. |
| A8 | Общий контракт + connection-колонки + `payload` jsonb. |

```text
OHS Timescale
  ├── link_liveness   ← голубой слой ribbon
  └── incident        ← цветной слой ribbon + экран журнала (OHS API)

OHS / другие сервисы  ──publish notify──▶  NC (отдельный сервис + БД)
                                              └── atoms / Thread UI (док)

Admin Front ──OHS──▶ liveness + incidents (ribbon, журнал эпизодов)
Admin Front ──MFE──▶ NC (лента уведомлений)
```

As-is: mock Hub + V025 atoms в OHS — переходный; atoms уедут в NC.  
**Журнал `incident` проектируем и делаем в OHS** (рядом с `link_liveness`).

---

## 6. Объектная модель / поля таблицы

```text
Incident
  corr_uid          text PK     = correlationId NC (subject:uid)
  module            text        connection | api | writer | …
  type              text        у connection: break | crash
  status            text        active | recovering | resolved
  close_outcome     text?       recovered | abandoned_schedule | abandoned_manual
  opened_at         timestamptz старт → красный 1px
  closed_at         timestamptz? конец; null пока open
  subject           text        префикс без uid
  severity          text        ok|info|warning|error|critical
  title             text        заголовок списка
  last_activity_at  timestamptz
  payload           jsonb?      прочий контекст

  -- module=connection (NULL иначе)
  connection_id     long?
  source_id         smallint?
  escalated_at      timestamptz?  handover → жёлтое|красное
  subtype           text?         degraded|down|host_unavailable|exception_500|…
  owner             text?         transaq|supervisor|admin
```

`duration_ms` — только в API: `(closed_at ?? now) − opened_at`.  
`abandoned` на ленте = `close_outcome IN (abandoned_schedule, abandoned_manual)`.

### 6.1. DDL-эскиз (**OHS** `db/migrations`)

```sql
-- V028__incident_journal.sql (OHS Timescale)
CREATE TABLE IF NOT EXISTS incident (
  corr_uid          text PRIMARY KEY,
  module            text NOT NULL,
  type              text NOT NULL,
  status            text NOT NULL
                      CHECK (status IN ('active', 'recovering', 'resolved')),
  close_outcome     text NULL
                      CHECK (close_outcome IN (
                        'recovered', 'abandoned_schedule', 'abandoned_manual')),
  opened_at         timestamptz NOT NULL,
  closed_at         timestamptz NULL,
  subject           text NOT NULL,
  severity          text NOT NULL
                      CHECK (severity IN ('ok','info','warning','error','critical')),
  title             text NOT NULL DEFAULT '',
  last_activity_at  timestamptz NOT NULL,
  connection_id     bigint NULL,   -- как connector_connection
  source_id         smallint NULL,
  escalated_at      timestamptz NULL,
  subtype           text NULL,
  owner             text NULL,
  payload           jsonb NULL,
  CHECK (closed_at IS NULL OR closed_at >= opened_at),
  CHECK (
    (status = 'resolved' AND closed_at IS NOT NULL AND close_outcome IS NOT NULL)
    OR (status <> 'resolved' AND closed_at IS NULL AND close_outcome IS NULL)
  )
);

CREATE INDEX ix_incident_journal
  ON incident (module, status, opened_at DESC);
CREATE INDEX ix_incident_connection_window
  ON incident (connection_id, opened_at DESC)
  WHERE module = 'connection' AND connection_id IS NOT NULL;
CREATE INDEX ix_incident_open
  ON incident (module, status)
  WHERE status IN ('active', 'recovering');
```

Не hypertable. Retention — отдельно (resolved старше N дней).

---

## 7. Запись эпизода: OHS → journal + NC (fan-out)

### 7.0. Инвариант (I2)

**Источник факта — домен OHS** (обрыв, crash, abandon, recover, ручной resolve).  
NC только уведомляет; журнал — компактные границы эпизода для ганта. Оба получают **одну и ту же**
информацию по эпизоду (`corr`, границы, исход), разными формами:

```text
                ┌─► incident          границы (open / closed_at / close_outcome)
OHS ─ IncidentStep ─┤
                └─► notification+Hub  стек атомов → NC Thread (тот же corr / ts / outcome)
```

- Не строить `incident` SELECT’ом из `notification` (NC вторичен; без NC гант/журнал живы).
- Не два независимых write-path (`Hub.*` и `JournalRegistrator` из разных мест) — **один фасад
  fan-out** из одного DTO шага (`IncidentStep`).
- Форма: журнал = начало/конец (+ исход); NC = полный стек Entry. **Результат по эпизоду единый.**
- Дефект и приёмка — [issue.md](issue.md) **I2**.

### 7.1. JournalRegistrator / fan-out (**в OHS**) — as-is → to-be

> As-is: `JournalRegistrator` (только `incident`). **I2:** `IncidentStep` + `IncidentFanOut` —
> break + crash ingest + manual resolve через фасад; crash NC остаётся `hub.Ingest` (клиентский corr).  
> Не путать с **TradeWriter** / Recording-лентой.

| Событие | Журнал OHS | NC (атомы) |
|---------|------------|------------|
| Open Incident | INSERT `active`, `opened_at`, type/… | `connection.lost` / `backend.unavailable` … |
| Handover (break) | UPDATE `escalated_at`, owner/subtype | (маркер/данные в progress — по 7j) |
| Recovering | UPDATE `recovering` | progress / recovering atom |
| Recovered | UPDATE `resolved` + `recovered` + `closed_at` | `*.recovered` |
| Abandon schedule/manual | UPDATE `abandoned_*` + `closed_at` | `incident_closed` / manual close |
| Adopt после рестарта | строка есть → UPDATE | adopt / без нового corr |

PK = `corr_uid` (идемпотентность). Group/Single → **не** в `incident`.

As-is: атомы → Hub/V025; to-be gate 11→12 — Publisher → сервис NC. Связь нити и строки —
`corr_uid` = `correlationId`.

---

## 8. API / UI

### OHS (журнал + ribbon)

| API (OHS) | Назначение |
|-----------|------------|
| `GET /api/incidents?module&status&type&from&to&connectionId` | журнал, пагинация |
| `GET /api/incidents/{corr}` | деталь |
| `GET /api/connections/{id}/incidents?from&to` (или поле в `/coverage/link`) | окно для ribbon |
| `POST /api/incidents/{corr}/resolve` | ручное → `abandoned_manual` |
| `POST /api/incidents/backfill-recent` | разово: gaps вчера+сегодня (МСК) → journal (без кнопки в UI) |
| `GET /coverage/link` | **intervals** (liveness); gaps для инцидентов — deprecate |

### NC (лента уведомлений) — **не** владелец `incident`

| Контур | Роль |
|--------|------|
| As-is | `packages/notification-center` + Hub/V025 в OHS (mock) |
| To-be (gate 11→12) | отдельный сервис/репо; V025 atoms → БД NC; пакет → **MFE** |
| UI | док Thread; Front ходит в NC сам |

Экран «Журнал инцидентов» (список эпизодов) — **Admin Front ← OHS API**.  
Док уведомлений — **NC MFE**.

---

## 9. Связь с документами

| Документ | Роль |
|----------|------|
| to-threads §6.0–6.2 | as-is Thread над V025 |
| to-threads §6.3 | черновик полей → канон §6 здесь (**таблица в OHS**) |
| phase7j/incident.md | продюсер break/crash, owner, исходы |
| persistence.md / nc-availability §8 | atoms V025 → переезд в NC (отдельно от журнала) |
| plan.md gate 11→12 / C4 arch | вынос NC MFE + Admin Front |
| этот файл | канон журнала **`incident` в OHS** + контракт ленты |

---

## 10. Открытые вопросы

| # | Вопрос | Статус |
|---|--------|--------|
| J1 | Cutover V025 atoms → БД NC | **согласовано направление** (gate 11→12); не блокер 11.13a |
| J2 | Имя таблицы | **закрыт → `incident`** |
| J3 | Group в таблице? | **закрыт → нет** |
| J4 | Backfill истории | **закрыт (scoped):** forward + `backfill-open` + `POST /incidents/backfill-recent` (gaps вчера+сегодня МСК); старше — не заполняем |
| J5 | Реестр types | код v1: connection `break`\|`crash` |
| J6 | `duration_ms` | **только API** |
| J7 | `resolved_by` | **закрыт** → `payload.resolvedBy` на POST resolve |
| J8 | Crash → JournalRegistrator | **закрыт** — ingest/recover/abandon; ribbon без double-paint; connectionId в data |
| J9 | Fan-out journal↔NC (одна информация) | **закрыт → I2 RESOLVED** — фасад + break/crash/manual + регрессия |

---

## 11. Критерий готовности DESIGN

- [x] Поля §6 и слои §3–§4 согласованы.
- [x] **OHS:** `link_liveness` + `incident`; **NC:** поток `notification` / MFE.
- [x] JournalRegistrator §7 (OHS) и API §8 намечены.
- [x] Plan §12 принят → **11.13a DONE**.

---

## 12. План реализации (после DESIGN)

Фаза **11.13** — журнал в **OHS**. Вынос NC (atoms + MFE) — **gate 11→12**, не блокирует a–f.

| Шаг | Что | Критерий |
|-----|-----|----------|
| **11.13a** | Миграция OHS `V028__incident_journal.sql` + `IIncidentStore` | **DONE** — DbUp + 6 integration tests |
| **11.13b** | **JournalRegistrator**: Open/handover/close/Adopt → UPSERT `incident` (не TradeWriter / не recording-лента); crash J8 | **DONE** — break-пути + unit; crash open — 11.13f |
| **11.13c** | OHS API `GET /api/incidents` (+ окно для ribbon) | **DONE** — list/detail/by-connection + `durationMs` |
| **11.13d** | UI экран журнала в Admin Front (OHS web) | **DONE** — раздел «Журнал инцидентов» (`messages`) |
| **11.13e** | Connection-ribbon←`incident` (+ liveness); Recording←бинарная проекция (merge, без type) | **DONE** — Settings «Гэпы в работе» (`showWorkGaps` → `paintGapsAsIncidents`); mutex с тумблерами инцидентов; default journal |
| **11.13f** | Ручное resolve + backfill/регрессия 7j | **DONE** — POST resolve/backfill-open; UI; J8 ingest; ApiTest |

**Вне scope 11.13:** вынос NC-сервиса / перенос V025 (gate 11→12), WebGL, Keycloak, 7j.15/16.
**I12** (pool / orphan `ohs.unhandled`) — смежный 7j.22: клиент **DONE** (serialize refresh +
close-all health-ok); Host pool size не меняли — [../phase7j/plan.md](../phase7j/plan.md) §7j.22.

**Порядок:** a → b → c → (d ∥ e) → f. **I2:** docs ✓ → фасад ✓ → break ✓ → crash ✓ → тесты ✓.

**Коммиты:** `feat(ohs-11): …` / `docs(11): …` — только по просьбе пользователя.
