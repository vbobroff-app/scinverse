# Phase 11 — Журнал инцидентов (11.13)

**Статус:** `DESIGN AGREED` · **11.13a DONE** (миграция V028 + store + tests, 2026-07-29).  
Дальше — **11.13b** writer.

**Связано:** [plan.md](plan.md) §11.13 · [to-threads.md](to-threads.md) ·
[persistence.md](persistence.md) · wiki [`incident.md`](../../wiki-readme/incident.md) ·
продюсер [../phase7j/incident.md](../phase7j/incident.md) · handoff [`promt.md`](../../promt.md) §8.

**Не путать с phase 7h:** [`../phase7h/incident.md`](../phase7h/incident.md) — SUPERSEDED
как канон платформенного «инцидента». `link_liveness` остаётся слоем **живости**.

---

## 1. Зачем

Лента NC (Thread над V025) — **DONE**. Нужен first-class **журнал инцидентов**:

- одна строка на эпизод (`corr`), без `GROUP BY` по hypertable атомов;
- экран списка + фильтры + (позже) ручное resolve;
- **источник верхнего слоя Connection-ribbon** (цветные отрезки + 1px маркеры) вместо
  производных gaps из `link_liveness`.

---

## 2. Продуктовое определение

> Инцидент — нарушение работы **во время работы** (горизонт расписания или живой коннектор).  
> Сбой вне горизонта — только уведомление / Group в ленте NC, **не** строка журнала.

| Ситуация | Журнал | Лента NC |
|----------|--------|----------|
| Сбой в горизонте / при живом коннекторе | **да** | Thread Incident |
| Сбой вне горизонта | **нет** | Group / notify |
| Single без corr | нет | Single |

---

## 3. Слои Connection-ленты

```text
низ:   link_liveness      — голубые отрезки «связь жива» (schedule-bounded)
верх:  incident (journal) — цветные эпизоды + маркеры поверх
         ├── break  (низ подслоя)  — жёлтое / красное сплошное + 1px
         └── crash  (верх подслоя) — красная штриховка + 1px; paint поверх break
```

- Вложенность `crash` ⊆ `break` **не валидируем в схеме** — бэк/клиент уже так открывают;
  UI только красит crash сверху.
- Плановый stop / ручной off **без** предшествующего инцидента — не в журнале
  (серое / отсутствие голубого).
- Перспектива: тумблеры слоёв «только живность» / «только инциденты».

### 3.1. As-is (до переключения ribbon)

Сейчас верхний слой строится из gaps `link_liveness` (`POST /coverage/link`):

```text
intervals → голубое
gaps      → тело + маркеры  (QueryGapsAsync + CoalesceOwnerPhases)
```

Код: `ConnectionRibbon.tsx`, `LinkLivenessStore.CoalesceOwnerPhases`,
`overlayCrashOutageOnLink` (оптимистичный crash на клиенте).

### 3.2. To-be (OHS DB)

```text
intervals ← link_liveness     (OHS Timescale)  — голубое
incidents ← incident          (OHS Timescale)  — break + crash поверх
```

Обе таблицы — **в OHS**. Gaps из liveness больше не источник истины по инцидентам.

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
| Вид | `type=crash`, отдельный `corr` (`ohs.backend.outage:…`) |
| Тело | красная **штриховка** на `[opened_at, closed_at??now]` |
| Paint | **поверх** break (z-order); вложенность схемой не проверяем |
| Старт 1px | `opened_at` |
| Green | только `recovered` |
| Abandon | `abandoned_*` → клип без green |
| Детект host_unavailable | клиент (дроп WS); оптимистичная геометрия до прихода API |

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

## 7. Writer журнала (**в OHS**)

`ConnectionManager` / Supervisor / CloseBreak / Adopt / crash-path пишут **локально**
в таблицу `incident` (те же точки, что сейчас Open/Progress/Resolve в Hub):

| Событие | Журнал OHS |
|---------|------------|
| Open Incident | INSERT `status=active`, `opened_at`, type/module/… |
| Handover (break) | UPDATE `escalated_at`, `owner=supervisor`, `subtype=down` |
| Recovering | UPDATE `status=recovering` |
| Recovered | UPDATE `resolved` + `close_outcome=recovered` + `closed_at` |
| Abandon schedule/manual | UPDATE `resolved` + `abandoned_*` + `closed_at` |
| Adopt после рестарта | строка есть → UPDATE, не новый INSERT |

PK = `corr_uid` (идемпотентность). Group/Single → **не** в `incident`.

Параллельно OHS **публикует** notify-атомы в NC (as-is: Hub + V025; to-be: NC Publisher →
сервис NC). `corr_uid` связывает строку журнала OHS и нить в ленте NC.

---

## 8. API / UI

### OHS (журнал + ribbon)

| API (OHS) | Назначение |
|-----------|------------|
| `GET /api/incidents?module&status&type&from&to&connectionId` | журнал, пагинация |
| `GET /api/incidents/{corr}` | деталь |
| `GET /api/connections/{id}/incidents?from&to` (или поле в `/coverage/link`) | окно для ribbon |
| `POST /api/incidents/{corr}/resolve` | ручное → `abandoned_manual` |
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
| J4 | Backfill истории | открыт: окно из gaps+V025 / только forward |
| J5 | Реестр types | код v1: connection `break`\|`crash` |
| J6 | `duration_ms` | **только API** |
| J7 | `resolved_by` | с POST resolve |
| J8 | Crash-writer: кто INSERT в `incident` при client-led outage? | открыт → 11.13b |

---

## 11. Критерий готовности DESIGN

- [x] Поля §6 и слои §3–§4 согласованы.
- [x] **OHS:** `link_liveness` + `incident`; **NC:** поток `notification` / MFE.
- [x] Writer §7 (OHS) и API §8 намечены.
- [x] Plan §12 принят → **11.13a DONE**.

---

## 12. План реализации (после DESIGN)

Фаза **11.13** — журнал в **OHS**. Вынос NC (atoms + MFE) — **gate 11→12**, не блокирует a–f.

| Шаг | Что | Критерий |
|-----|-----|----------|
| **11.13a** | Миграция OHS `V028__incident_journal.sql` + `IIncidentStore` | **DONE** — DbUp + 6 integration tests |
| **11.13b** | Writer: Open/handover/close/Adopt → UPSERT `incident`; crash-path (J8) | строки пишутся; Adopt без дублей |
| **11.13c** | OHS API `GET /api/incidents` (+ окно для ribbon) | список/фильтры |
| **11.13d** | UI экран журнала в Admin Front (OHS web) | tsc/eslint |
| **11.13e** | Ribbon: incidents←`incident`, liveness←`link_liveness` | паритет yellow\|red / hatch / abandon |
| **11.13f** | Ручное resolve + backfill/регрессия 7j | оператор закрывает; сценарии |

**Вне scope 11.13:** вынос NC-сервиса / перенос V025 (gate 11→12), WebGL, Keycloak, 7j.15/16, I12.

**Порядок:** a → b → c → (d ∥ e) → f.

**Коммиты:** `feat(ohs-11): …` / `docs(11): …` — только по просьбе пользователя.
