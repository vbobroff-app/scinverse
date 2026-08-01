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
| P4.2 | Выключить `abandoned_schedule` close / классификатор | Auto stop ≠ resolve incident — **DONE** (Supervisor + client; API legacy) |
| P4.3 | Вычистить упоминания `:h` / `ConnectionScheduleDesiredOverlap` из docs и мёртвого кода | grep clean — **DONE** (в коде не было; docs/promt sync) |
| P4.4 | Wiki/layers sequenceDiagram → to-be | sync — **DONE** |

**Только после** стабильного P2+P3 на стенде.

---

### P5 — Опционально: 2NF crash journal

| Шаг | Что |
|-----|-----|
| P5.1 | DDL: факт crash + `incident_connection` scope |
| P5.2 | Fan-out emit → одна строка + N scope; ribbon/API читают join |
| P5.3 | Миграция исторических N rows (или dual-read) |

Не блокирует gate 11→12. Делать когда P4 стабилен.

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
5. (later) feat(ohs): 2NF incident_connection          ← P5
```

Между 2 и 3 — обязательная ручная проверка: ночной crash + утреннее окно + mask on/off +
SessionFilter moex.

---

## Инварианты, которые нельзя сломать

- Journal ⊥ NC (fan-out / SkipJournal семантика до P4 аккуратна).
- **I10:** stale-close open break только при `Live`.
- CloseBreak: WS resolve до journal; journal resolve await (`255cc93`).
- Ribbon refresh только через OhsStore pipeline (I12).
- TRANSAQ: `request_timeout=10`; без QuickPath / второй DLL.

---

## Чеклист старта нового чата

1. Прочитать `promt.md` §8 и `schedule-projection.md`.
2. Убедиться `git status` clean на базе после docs-коммита.
3. Начать с **P1** (Cutter), не с переписывания emitter.
4. Не воскрешать `:h` bake в journal.
