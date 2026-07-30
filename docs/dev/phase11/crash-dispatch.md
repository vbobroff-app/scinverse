# Phase 11 — Crash dispatch: транспорт + слой соединений

**Статус:** `DESIGN AGREED` · **IN PROGRESS** (D1–D6 DONE · D7…).  
**Дата согласования:** 2026-07-30 · план: 2026-07-30.

**Связано:** [incident-journal.md](incident-journal.md) (§2, §4.3 Crash, A6) ·
[to-threads.md](to-threads.md) · wiki [`incident.md`](../../wiki-readme/incident.md) ·
продюсер [../phase7j/incident.md](../phase7j/incident.md) · [plan.md](plan.md).

**As-is (до этой спеки):** один клиентский corr `ohs.backend.outage:{ms}` → один NC Thread +
одна строка `incident` с опциональным `connection_id`. Ломается при N connections с разным
schedule и при нескольких admin-клиентах.

---

## 1. Зачем

Падение Host (WS drop) — **один факт**. Impact и классификация Incident vs Group зависят от
**расписания конкретного connection**. Несколько admin-клиентов шлют POST независимо — их
нужно схлопнуть, не размножая «транспортные» нити.

Цель: жёсткая привязка провайдерского crash к `connectionId`; транспорт admin↔OHS — отдельный
слой без `connectionId`; journal только для Incident на соединениях.

---

## 2. Два слоя

| Слой | Имя | Контекст | `connectionId` | Journal | NC |
|------|-----|----------|----------------|---------|-----|
| **T** | **Транспортный** (admin ↔ OHS) | «пропала / вернулась связь с сервером» | **нет** | **нет** | один Group |
| **C** | **Слой соединений** (connection / provider) | влияние простоя Host на каждый enabled connection | **обязателен** | только **Incident** | Incident **или** Group на каждый id |

В UI connection ≈ провайдер; в спеке канон — **слой соединений** (ключ всегда `connectionId`).

```text
WS drop (N admin clients)
        │
        ▼
  [локальный Single «нет WS»]     ← только память клиента; не audit
        │
   WS up + POST ×N (clientId)
        │
        ▼
  Supervisor (дедуп)
        ├── слой T: 1× Group (без connectionId)     → NC only
        └── слой C: ∀ enabled connection
              ├── desired(schedule, openedAt) → Incident + journal + NC
              └── иначе                       → Group + NC (без journal)
```

---

## 3. Слой T — транспортный (единый клиент)

### 3.1. Режим

В данном OHS-случае — **единая клиентская модель**: в NC **не** фильтруем и **не** размножаем
нити по `clientId`. Пачка POST от разных admin → один транспортный эпизод.

### 3.2. Форма NC

Один **Group** (не два несвязанных Single):

| Entry | Severity | Смысл (черновик текста) |
|-------|----------|-------------------------|
| open | error / critical | Пропала связь с сервером |
| close | ok | Сервер OHS снова доступен |

- один `corr`, один `resolved`;
- **без** `connectionId` → в фильтре NC по connection не мешает;
- `sender` в NC: схлопнутый `client` (не перечень clientId).

### 3.3. Corr (черновик)

```text
ohs.host.transport:{outageSeed}
```

`outageSeed` — стабильный ключ эпизода (см. §5), общий для T и C.

### 3.4. Журнал

Транспортный слой в `incident` **не** пишется (A6 + «только NC»).

---

## 4. Слой C — соединения

### 4.1. Обход

После дедупа POST супервизор обходит все **enabled** `connector_connection` из БД
(провайдер установлен). Disabled / отсутствующие — не трогаем.

Для каждого `connectionId`:

```text
if desired(schedule, openedAt) → threadKind = incident  (+ journal type=crash)
else                           → threadKind = group     (NC only)
```

`desired` — тот же резолвер, что у Auto/break (date > dow > main; TZ расписания).

На один outage-окно у connection ровно **одна** нить (Incident **или** Group), не обе.

### 4.2. Corr (черновик)

```text
ohs.backend.outage:{outageSeed}:c{connectionId}
```

- один Host-outage → N нитей;
- фильтр NC по `connectionId` работает;
- header Thread содержит / резолвит connection id (и имя, если есть).

### 4.3. Journal

| threadKind | `incident` row |
|------------|----------------|
| incident | да: `type=crash`, `subtype=host_unavailable`, `connection_id`, `owner=admin` |
| group | нет |

Ribbon Connection красит только строки журнала с этим `connection_id` (+ optimistic gap до API).

### 4.4. `clientId` на слое соединений

На слое C `clientId` **может** присутствовать в `data` — **аудит оператора** (кто изменил
schedule у connection, ручные действия), **не** ключ диспетчеризации crash и не ключ Thread.

Crash fan-out всегда от супервизора по БД + schedule, независимо от того, какой admin первым
прислал POST.

---

## 5. Мультиклиент и дедуп

| Правило | Описание |
|---------|----------|
| Вход | каждый admin POST с `sender` / `clientId` + окно outage (`from` / `to` или open+recover) |
| Дедуп | супервизор собирает пачку в **один** эпизод |
| `openedAt` | например **min**(`from` по клиентам) |
| `closedAt` | момент, когда супервизор считает Host recovered (не N независимых close) |
| Идемпотентность | повторный POST с тем же `outageSeed` / перекрывающимся окном → no-op / merge |
| NC | `clientId` транспортных POST **не** становится отдельными Thread |

Точная форма `outageSeed` и окно слияния — на этапе плана реализации.

---

## 6. Клиентский фейк (до POST)

| Фаза | Поведение |
|------|-----------|
| WS down | локальная **Single** «нет связи с сервером» (без Thread; без persist в `notification`) |
| Storage | память и/или localStorage — **решение отложено** |
| WS up | POST на бэк (сигнал outage/recover) → супервизор §3–§4 |
| Hydrate | локальную Single **убрать / не дублировать** с транспортным Group с бэка |

Optimistic геометрия на ганте (шлеф crash) — по локально известным connections или только после
ответа fan-out (уточнить в плане).

---

## 7. Инварианты

1. **Слой T:** Group без `connectionId`; только NC; единый клиент (без NC-логики по clientId).
2. **Слой C:** каждый атом / нить с **обязательным** `connectionId`; одна нить на connection на эпизод.
3. **Journal:** только Incident слоя C; транспорт и Group соединений — не в `incident`.
4. **Нет угадывания connectionId** на Host из «первого live / non-synthetic» — список из БД + schedule.
5. **As-is client-led** один corr на всех connections — **superseded** этой спекой (после реализации).

---

## 8. Контракт POST (эскиз, не API freeze)

Клиент после WS up шлёт сигнал эпизода (один или open+recover), а не сам раскладывает N нитей.

```text
POST /api/…  (имя эндпоинта — план)
{
  clientId: string,           // admin instance; для дедупа T, не для NC-фильтра
  from: timestamptz,          // детект drop (клиентские часы)
  to?: timestamptz,           // recover; если отдельно — второй вызов
  outageSeed?: string         // опц. стабильный ключ; иначе Host выводит
}
```

Дальше Host:

1. Merge в текущий / новый outage-эпизод (`min` from, …).
2. Emit слой T (Group open/close) — идемпотентно.
3. Emit слой C ∀ enabled connection — идемпотентно по corr `:c{id}`.
4. Journal Open/Resolve только для Incident.

Точные code/message/`threadKindHint` — в плане; семантика как у нынешних
`backend.unavailable` / `backend.recovered`, но **автор durable NC — Host**, не клиентский
mock-POST атомов на каждый connection.

---

## 9. Пример (N=2 connections)

Connections: `1` (вне окна), `3` (в desired). Два admin POST.

**NC после fan-out:**

```text
Group  ohs.host.transport:{seed}          ← без connectionId
  ERROR  Пропала связь с сервером
  OK     Сервер OHS снова доступен

Group  ohs.backend.outage:{seed}:c1       ← connectionId=1
  … stack …

Incident  ohs.backend.outage:{seed}:c3    ← connectionId=3
  … stack …
```

**Journal:** одна строка crash для `connection_id=3`.  
Фильтр NC `connectionId=3` → только Incident `:c3` (транспорт не виден).

---

## 10. Вне scope этой спеки

- Выбор storage локального фейка (memory vs localStorage).
- Вынос NC-сервиса (gate 11→12).
- Миграции схемы `incident` (connection_id уже есть).
- UI-тексты / i18n финальные формулировки.
- Break (обрыв link) — без изменений; эта спека только **Host crash** dispatch.

---

## 11. Решения по открытым пунктам (заморозка для плана)

| # | Решение |
|---|---------|
| **Q1** | Новый **`POST /api/recovery/outage`** — сигнал эпизода от клиента. `POST /api/notifications` остаётся для прочих атомов; **клиентский** mock-POST `backend.unavailable` / `backend.recovered` для crash **снимаем** (Host сам публикует T+C). |
| **Q2** | `outageSeed = minFrom.UnixMs`. Merge POST только если **тот же `code`** (default `host.unreachable`) **и** `|from − openedAt| ≤ MergeWindow` (120 s). Message не ключ. `openedAt = min(from)`; close по первому `to` → один close для T и всех C. |
| **Q3** | Optimistic ribbon: на WS drop красить **все** connections из локального `connections$` (interrupted gap). После hydrate/`GET …/incidents` — журнал уточняет Incident; Group-only connections без journal-строки остаются с optimistic до refresh или клипа по `to`. |
| **Q4** | Слой T — **новые коды**: `host.unreachable` (open) / `host.reachable` (close), `threadKindHint=group`, без `connectionId`. Слой C — reuse `backend.unavailable` / `backend.recovered` (+ progress опц.), с `connectionId` и hint incident\|group. |
| **Q5** | `connectionIds[]` в T — **не в MVP**. |

---

## 12. Связь с as-is кодом

| As-is | To-be |
|-------|-------|
| Клиент `openBackendOutage` → один Thread + mock-POST | Локальный Single; durable — Host fan-out |
| `threadKindHint` от client horizon | Слой C: Host `ConnectionScheduleResolver` per connection |
| Journal crash от client `backend.unavailable` | Journal только Host fan-out Incident слоя C |
| Один `connectionId` в data или null | T: нет id; C: всегда id |
| `POST /recovery/hold` + gate | **сохраняем** (барьер Auto); outage-сигнал — отдельный endpoint |

---

## 13. План реализации

### 13.0. Corr и коды (канон плана)

```text
outageSeed              = minFrom Unix ms (UTC)
T corr                  = ohs.host.transport:{outageSeed}
C corr                  = ohs.backend.outage:{outageSeed}:c{connectionId}

T open                  = host.unreachable     severity=error|critical  hint=group
T close                 = host.reachable       severity=ok              status=resolved
C open                  = backend.unavailable  hint=incident|group      + connectionId
C close                 = backend.recovered    (+ closeOutcome)         + connectionId
```

`clientId` в теле POST — для лога/дедупа; в NC атомах T: `sender=client` (схлоп).

### 13.1. Контракт API

```text
POST /api/recovery/outage
{
  "clientId": "string",       // обязателен (uuid/tab id админки)
  "from": "timestamptz",      // детект drop
  "to": "timestamptz" | null  // null = ещё open; non-null = recover этого клиента
}
→ 202 Accepted
→ side effects: merge episode; при first open → emit T open + C opens;
               при first close (to) → emit T close + C resolves (+ journal resolve)
```

Идемпотентность: повтор open/close того же seed — no-op (Hub/Journal уже умеют).

Параллельно: `POST /api/recovery/hold` без изменения семантики 7j.20.

### 13.2. Шаги (порядок)

| Шаг | Что | Критерий готовности |
|-----|-----|---------------------|
| **D1** | `HostOutageCoordinator` + `POST /api/recovery/outage` — **DONE** | Unit: два clientId → один seed; min from; один close |
| **D2** | Emit **слой T**: `HostOutageTransportEmitter` → Hub Ingest open/close, hint=group, без journal — **DONE** | Unit: 2 атома, без connectionId; merge не дублирует open |
| **D3** | Emit **слой C**: ∀ enabled connection; `desired` через `ConnectionScheduleResolver`; Incident→Hub Ingest+journal; Group→Hub only — **DONE** | Unit: N enabled → N corr `:c{id}`; journal только desired |
| **D4** | Снять client-led journal path для crash из `POST /notifications` — **DONE** | ApiTests: journal через `/recovery/outage`; client `backend.unavailable` → NC only |
| **D5** | Клиент: WS down → **локальная Single** (не Thread); убрать `openBackendOutage` Thread+queue атомов crash — **DONE** | vitest: Single без Thread; dismiss на hydrate `ohs.host.transport:` |
| **D5a** | NC фильтр «Соединение» (show/hide Id) — **DONE** | Скрыть id=1; без id в data остаётся видимым |
| **D6** | Клиент: WS up → `POST /recovery/outage` `{clientId, from, to}` (+ hold как сейчас); не mock-POST backend.* для crash — **DONE** | vitest: body from/to; pending в `localStorage` до 2xx POST |
| **D7** | Optimistic ribbon на **все** `connections$`; после incidents refresh — journal wins | Ручной: 2 connection, desired разный → 1 journal + 2 NC C-threads |
| **D8** | Регрессия + docs: report.md, статус спеки → `IN PROGRESS`/`DONE` | unit + ApiTest зелёные |

**Порядок жёсткий:** D1→D2→D3→D4, затем D5→D6→D7, D8 в конце. D2∥D3 на одном PR допустимо, если coordinator готов.

### 13.3. Компоненты (где трогаем)

**Host**

- новый `HostOutageCoordinator` (+ DI);
- `OhsEndpoints`: map `POST /recovery/outage`; упростить crash-ветку `/notifications`;
- emit через существующий `IIncidentFanOut` / Hub (для Group C — Open+Resolve с `SkipJournal` или отдельный helper);
- schedule: уже есть `ConnectionScheduleResolver` + `IConnectionStore.ListAsync`.

**Web**

- `OhsStore.onBackendDrop` / `onBackendReachable`: Single + outage POST вместо `openBackendOutage`/`resolveBackendOutage` persist;
- `clientId`: стабильный per browser tab (`sessionStorage` uuid) — достаточно для админки;
- локальный фейк: **memory only** в MVP (localStorage — later, вне D5);
- `notifications.ts`: helpers для локальной Single; deprecate crash Thread helpers или оставить для тестов до D5.

**Не трогаем:** break/link path, Recording, gate 11→12, schema migrations.

### 13.4. Тесты

| Уровень | Сценарии |
|---------|----------|
| Unit coordinator | merge 2 clients; seed=minFrom; second close no-op; вне MergeWindow → новый эпизод |
| Unit/Api fan-out | 0 enabled → только T; 1 desired + 1 idle → 1 journal + 2 C threads + 1 T |
| Api | идемпотентный повтор POST; Group C без строки incident |
| Web vitest | Single on drop; POST body; dismiss Single when transport Group arrives in backlog |

### 13.5. Риски и смягчение

| Риск | Смягчение |
|------|-----------|
| Часы клиента разъехались | merge window 120s; Host может clamp `from` ≤ UtcNow |
| Host рестарт посреди outage | in-memory episode потерян → новый seed от следующего POST; acceptable MVP (документировать) |
| Двойной шум old+new клиент | D4/D5: выключить mock-POST crash до включения D6 |
| Фильтр NC по connection | T без id — ок; проверить deriveSubject для `ohs.host.transport:` |

### 13.6. Критерий приёмки (done)

1. Два admin POST на один outage → **один** T Group в NC.
2. Два enabled connection (desired / не desired) → Incident+journal и Group без journal; оба с `connectionId`.
3. Локальная Single до POST; после hydrate нет дубля с T.
4. В `incident` нет строк без `connection_id` для новых crash.
5. Break-сценарии 7j не регрессируют.
6. Фильтр NC «Подключение» скрывает synthetic / выбранные id (§13.7).

### 13.7. Фильтр NC по `connectionId` — **DONE** (MVP)

NC не знает каталог connections; фильтр только по числу из `data.connectionId`.

| | |
|--|--|
| **UI** | Chip «Соединение»: Показывать все · Показывать Id=[input] · Скрывать Id=[input] |
| **Семантика** | hide побеждает show; атомы без `connectionId` не режутся include |
| **Persist** | `ohs:notificationDock` (`filter.connection`) |

**Не путать** с фильтром журнала инцидентов (`GET /incidents?connectionId`).

---

## 14. Оценка объёма (ориентир)

| Блок | Ориентир |
|------|----------|
| D1–D3 Host | 1.5–2.5 дня |
| D4 cutover + тесты | 0.5–1 день |
| D5–D7 client | 1–1.5 дня |
| D8 регрессия/docs | 0.5 дня |
| **Итого** | **~4–6 рабочих дней** |

---

**Следующий шаг после утверждения плана:** начать **D1** (`HostOutageCoordinator` + endpoint).
