# План: переход на schedule-as-projection

**Статус:** `READY` · старт в новом чате  
**Канон модели:** [`schedule-projection.md`](schedule-projection.md)  
**Handoff:** [`docs/promt.md`](../../promt.md) §8

Цель — деликатно заменить классификацию «Incident vs Group по расписанию» на
**факты + проекция**, не ломая Live Adopt (I10), ribbon pipeline (I12) и приемку crash D1–D8
в переходный период.

---

## Принципы миграции

1. **Сначала additive** (Cutter, UI mask) — as-is journal/NC ещё работают.
2. **Потом switchover классификации** (всегда Incident + journal полный span).
3. **Потом вырезать** Group-outage / `abandoned_schedule` / мёртвый `:h` из docs и кода.
4. **2NF journal** — отдельный поздний шаг; не блокирует mask/Cutter.
5. Каждый шаг — зелёные unit + vitest + ручной сценарий ночь↔утро; коммит по просьбе.
6. Host DLL: перед `dotnet build/test` остановить VS Host.

---

## Фазы

### P0 — Документы и якоря (этот коммит / чат)

- [x] Wiki [`incident.md`](../../wiki-readme/incident.md) — новое определение
- [x] Wiki [`layers.md`](../../wiki-readme/layers.md) — факты ⊥ schedule; as-is помечен
- [x] Спека [`schedule-projection.md`](schedule-projection.md)
- [x] Этот план + [`promt.md`](../../promt.md) §8
- [x] Пометки obsolete в [`crash-dispatch.md`](crash-dispatch.md) / [`incident-journal.md`](incident-journal.md) §2
- [ ] В новом чате: коротко подтвердить acceptance §9 спеки с пользователем, если что-то спорно

**Не трогать код в P0.**

---

### P1 — ScheduleCutter ( Domains / Host, без смены NC )

**Зачем первым:** writers получают честный «нет данных в окне» ещё до смены journal-политики;
можно тестировать на as-is данных (journal уже содержит desired-incidents; overnight gaps —
через coverage / позже полный journal).

| Шаг | Что | Критерий |
|-----|-----|----------|
| P1.1 | `ScheduleCutter` (или имя в Domain): вход intervals + desired windows → clipped | unit: empty / full / partial / overnight / multi-window |
| P1.2 | Провод к потребителю writers / recovery API (минимальный) | один call-site; без UI |
| P1.3 | Не менять `HostOutageConnectionEmitter` classification | регресс crash fan-out as-is |

**Риск низкий:** чисто additive.

---

### P2 — UI Schedule void mask (Connection ribbon)

| Шаг | Что | Критерий |
|-----|-----|----------|
| P2.1 | Toggle (settings / toolbar) ⊥ SessionFilter | Full-ось не схлопывается |
| P2.2 | Отрисовка void поверх трека; z-order §5.2 спеки | liveness+incident гасятся вместе |
| P2.3 | Tooltip «Окно простоя HH:MM – HH:MM» | vitest / story |
| P2.4 | Desired из того же резолвера, что Auto (TZ, date>dow>main) | паритет с бэком |

**Риск средний:** z-order / WebGL-DOM слои. Не клиповать journal на клиенте «вместо» маски.

---

### P3 — Always-Incident + полный journal span

| Шаг | Что | Критерий |
|-----|-----|----------|
| P3.1 | Crash fan-out: для каждого enabled connection → Incident + journal **всегда** | нет ветки Group по `desired@open` — **DONE** |
| P3.2 | Break: убедиться, что нет скрытых «вне горизонта → не journal» | open path всегда Incident (desired ≠ SkipJournal) — **DONE** |
| P3.3 | NC: outage threads всегда Incident; фильтр `connectionId` | vitest projectThreads — **DONE** |
| P3.4 | Обновить crash-dispatch §4 как as-was / to-be pointer | docs — **DONE** |

**Переходный момент:** на ганте без маски ночные crash станут видимы полностью — это **правильно**;
маска (P2) должна уже быть, иначе UX-шок. **Порядок: P2 перед или сразу с P3.**

Рекомендация: **P2 → P3** в одном PR-окне или P2 merge first.

---

### P4 — Удаление legacy classification

| Шаг | Что | Критерий |
|-----|-----|----------|
| P4.1 | Убрать Group emit для connection outages | нет SkipJournal Group path — **DONE** (Host P3 + client default Incident; Auto Group connect оставлен) |
| P4.2 | Выключить `abandoned_schedule` close / классификатор | Auto stop ≠ resolve; live API сняты; backfill `Abandoned`→`active` (не schedule-resolve) — **DONE**. **`abandoned_manual` + UI resolve не трогать** |
| P4.3 | Вычистить упоминания `:h` / `ConnectionScheduleDesiredOverlap` из docs и мёртвого кода | grep clean — **DONE** (в коде не было; docs/promt sync) |
| P4.4 | Wiki/layers sequenceDiagram → to-be | sync — **DONE** |

**Только после** стабильного P2+P3 на стенде.

---

### P5 — 2NF crash journal

**Статус design (P5.0):** решения зафиксированы 2026-08-01. Код — после явного старта.  
Не блокирует gate 11→12.

**Зачем:** crash = транспортный факт; as-is fan-out N строк `ohs.backend.outage:{seed}:c{id}`
дублирует close/resolve и путает Connection-ribbon. Break остаётся 1:1 connection.

#### Решения P5.0

| # | Решение |
|---|---------|
| D1 | Corr transport: `ohs.backend.outage:{seed}` (**без** `:c{id}`). `:c{id}` — legacy. |
| D2 | Journal: **1** строка `type=crash`, `connection_id = NULL`; scope — таблица `incident_connection (corr_uid, connection_id)`. |
| D3 | Scope на open: snapshot **enabled** connections (как нынешний fan-out). Mid-outage enable → v1 **не** добавляем в scope. |
| D4 | NC: **1** Incident Thread на transport (TL); ribbon/API scope — `connectionIds` / join. Dock «Коннекторы» show/hide Id — только CL ([layers.md §8](../../wiki-readme/layers.md)). |
| D5 | Resolve / `abandoned_manual` / recover — **одна** операция на transport corr → все ribbon/API. |
| D6 | **История MVP:** dual-read / migrate старых NC atoms **не делаем**. Cutover = purge таблицы `notification` (+ перезапуск Host: Hub — in-memory ring, иначе UI видит старое). Journal `:c{id}` на стенде — purge или one-shot migrate без dual-read API (выбрать при старте P5.1; предпочтение стенда — purge crash-строк вместе с NC). |
| D7 | Расписание / Cutter / mask **не** участвуют в модели crash (P4). |
| D8 | UI toggles: «Инциденты связи» (break) ⊥ «Инциденты сервера» (crash via scope). |

#### Шаги кода

| Шаг | Что | Критерий |
|-----|-----|----------|
| P5.0 | Docs (этот блок + pointers в speке/promt) | **DONE** (docs) |
| P5.1 | DDL `incident_connection` + store scope + Query join | **DONE** (`V029`, Replace/List scope, Query via join) |
| P5.2 | Emit 1+N; GET connection incidents = break ∪ crash-via-join; ribbon crash | **DONE** (Host emit + ribbon/`connectionIds` scope; dock Id = CL-only) |
| P5.3 | Cutover стенд: purge NC (+ Host restart); journal legacy crash — purge/migrate per D6 | **DONE** (NC=0; legacy `:c{id}` crash=0; Host restart) |
| P5.4 | Убрать emit `:c{id}`; sync crash-dispatch / incident-journal | **DONE** (helpers dropped; speки synced) |
| P5.5 | I13: adopt/open/resolve SoT = journal (не `notification`/Hub) | **DONE** — иначе purge NC ⇒ break⊂break |

#### Acceptance

1. Один Host-outage → одна journal-строка crash + N scope.
2. Connection ribbon «Инциденты сервера» iff `connectionId ∈ scope`.
3. Один recover / один manual close закрывает весь эпизод.
4. После cutover нет опоры на историю NC atoms (MVP).
5. Регресс: break, mask, Auto≠resolve, I10, toggles break/crash.
6. **I13:** NC off / purge → supervisor не плодит второй break; adopt из journal.

---

### P6 — Вне скоупа этого плана (не смешивать)

- Gate **11→12** NC MFE / Keycloak
- WebGL Gantt (phase 12)
- 7j.15 / 7j.16 UI backlog
- Подъём `Max Pool Size` (I12 defer @100)

---

## Рекомендуемый порядок коммитов (новый чат)

```text
1. feat(ohs): ScheduleCutter + unit                    ← P1
2. feat(ohs-web): schedule void mask toggle            ← P2
3. feat(ohs-11): always-Incident crash/break journal   ← P3
4. refactor(ohs-11): remove Group outage + abandon     ← P4
5. docs(11): P5.0 2NF decisions                             ← P5.0
6. feat(ohs): incident_connection DDL + store               ← P5.1
7. feat(ohs-11): 2NF crash emit/query                       ← P5.2
8. chore: cutover purge NC (+ Host restart); drop :c{id}    ← P5.3–4
9. fix(ohs-11): adopt/open SoT from journal (I13)           ← P5.5
```

Между 2 и 3 — обязательная ручная проверка: ночной crash + утреннее окно + mask on/off +
SessionFilter moex.

---

## Инварианты, которые нельзя сломать

- Journal ⊥ NC (fan-out / SkipJournal семантика до P4 аккуратна).
- **I10:** stale-close open break только при `Live`.
- **I13:** open-break adopt/gate — journal (+ Manager), не `notification`/Hub.
- CloseBreak: WS resolve до journal; journal resolve await (`255cc93`).
- Ribbon refresh только через OhsStore pipeline (I12).
- TRANSAQ: `request_timeout=10`; без QuickPath / второй DLL.
- **`abandoned_manual` + UI resolve** — обязательны и остаются после P4. Без ручного закрытия
  open break/crash могут висеть `active` бесконечно. Не вырезать вместе с schedule-abandon.
- Journal **не** режется расписанием: клип — `ScheduleCutter` / UI mask. Backfill не синтезирует
  `abandoned_schedule` из ribbon `Abandoned`.

---

## Чеклист старта нового чата

1. Прочитать `promt.md` §8 и `schedule-projection.md`.
2. Убедиться `git status` clean на базе после docs-коммита.
3. Начать с **P1** (Cutter), не с переписывания emitter.
4. Не воскрешать `:h` bake в journal.
