# Stage 1 — Abandoned (хвосты вне MVP)

Единый реестр всего, что **не сделали / отложили** в фазах **4–8** при закрытии Stage 1
(2026-08-04). MVP считается достаточным; пункты ниже — backlog (production / после WebGL /
следующие Stages).

Корневой план: [../plan.md](../plan.md).  
После реализации — вычеркнуть здесь и коротко отметить в report исходной фазы.

---

## Phase 4 — E2E OHS / TRANSAQ

Открытых хвостов в docs **нет** (фаза DONE).

---

## Phase 5 — мультиисточник

| # | Что | Источник | Горизонт |
| - | --- | -------- | -------- |
| 5.1 | `instrument_alias` (обобщение `transaq_secid` при втором источнике на тот же инструмент) | [phase5/plan](../phase5/plan.md) «Не входит» | future / второй источник |
| 5.2 | `source_id` в `md_orderlog` / `md_book_snapshot` | тот же | Future Features / Plaza2 |
| 5.3 | `data_source.priority` (выбор источника на чтении) | тот же | ODS |

---

## Phase 6a / 6b / 6c

Открытых хвостов MVP **нет** (DONE).

| # | Что | Примечание |
| - | --- | ---------- |
| 6c.1 | UI-дерево «Список ↔ Дерево» | **WONT** — фильтры 7d; бэк `groups` остаётся |

---

## Phase 7 — каркас админки (IA)

| # | Что | Решение | Горизонт |
| - | --- | ------- | -------- |
| 7.L1 | Отдельный экран навигации «выбор биржи» | WONT MVP (UX + 7c/7e) | — |
| 7.L2 | Обзорный Гант по всем провайдерам | DEFERRED | после WebGL (phase 12) |
| 7.TREE | Дерево деривативов в каталоге | WONT | фильтры 7d |
| 7.KEYSET | Keyset-пагинация каталога | отложено (offset+total ок) | later |

Канон: [../phase7/report.md](../phase7/report.md) §Закрытие.

---

## Phase 7b — таймфреймы

| # | Что | Источник | Горизонт |
| - | --- | -------- | -------- |
| 7b.1 | Portal-тултип для колбасок (вместо native `title`; `overflow:hidden`) | [report Follow-up](../phase7b/report.md) | UX polish |
| 7b.2 | Реальный `sec_status` «торгуется/спит» | [plan out of scope](../phase7b/plan.md) | later (см. также 7c.9) |

---

## Phase 7c — ISS / Биржи

| # | Что | Источник | Горизонт |
| - | --- | -------- | -------- |
| **7c.8** | Лента новостей/событий ISS `sitenews`/`events` + канал коннектора | report DEFERRED | отдельный раздел «Новости» |
| **7c.9** | Статус инструмента в карточке: слой A (расписание борда) + слой B (активность записи) | report DEFERRED | ближе к живости / UX |
| 7c.CACHE | Персистентный кэш календаря ISS (сейчас `IMemoryCache`) | plan → Phase 13 | Stage 4 / phase 13 |
| 7c.CURATE | Ручное курирование `futures_asset_class` (`confirmed`) поверх авто | apply §3f | later |
| 7c.SEC | Биржевой флаг приостановки бумаги (`sec_status` / suspended) | plan out of scope | later |
| 7c.CLR | Использование settlement/clearing сессий в UI (сейчас читаем, не рисуем) | plan out of scope | later |

---

## Phase 7d — фильтры каталога

| # | Что | Источник | Горизонт |
| - | --- | -------- | -------- |
| 7d.1 | Персист набора фильтров в `localStorage` | report / plan follow-up | UX |
| 7d.2 | Реальная мультибиржа в фильтрах (сейчас по сути MOEX) | report | при втором рынке |

---

## Phase 7e — подключения UI

Фаза в корневом плане — MVP DONE (форма + connect живут в проде). В **старом** report ещё висели:

| # | Что | Примечание | Горизонт |
| - | --- | ---------- | -------- |
| 7e.6 | vitest на команды `OhsStore` create/credentials (+ api-smoke без секретов) | report TODO | долг тестов |
| 7e.LIVE | Чеклист «живой Transaq realtime» в report 7e | фактически пройден позже (7h Finam); docs stale | закрыть в report при случае |
| 7e→7c.9 | Статус инструмента в карточке | дубль **7c.9** | см. 7c |

---

## Phase 7f — тайм-лайн / TZ

| # | Что | Источник | Горизонт |
| - | --- | -------- | -------- |
| 7f.1 | Пиновка / клик-тултип, превью стакана/ленты | plan out of scope | follow-up / WebGL |
| 7f.2 | Пересчёт границ дня по чужому расписанию биржи (`reshapeDay` TODO-хук) | plan / apply | мультибиржа |
| 7f.3 | Полный мультибиржевой TZ beyond MOEX-скелета | plan → 7c+ | later |

---

## Phase 7g — слой сделок

| # | Что | Источник | Горизонт |
| - | --- | -------- | -------- |
| 7g.1 | Continuous aggregates / materialized rollups активности | plan out of scope | scale / phase 12 LOD |
| 7g.2 | Наложение нескольких `source_id` на одной дорожке | plan out of scope | later |
| 7g.3 | Order-book / лента-превью в тултипе | plan out of scope | follow-up |
| 7g.4 | Backfill / эталонная сверка «были ли сделки в дыре» | plan → 7c/9 | см. WG.1, QScalp |

---

## Phase 7h — liveness / Write Gaps / Connection lane

**DONE:** liveness, Connection-ribbon (`link_liveness` + journal incidents), Write Gaps на Writers,
startup-latency. Красный на инструменте = WriteGap (не as-is incident binary).

| # | Что | Источник | Горизонт |
| - | --- | -------- | -------- |
| **WG.1** | Backfill WriteGap из истории коннектора (TRANSAQ history → `md_trade`) | write-gaps | production later |
| 7h.8d | Lifecycle: coverage-сегмент «живёт через обрыв» (reconnect → тот же segment) | report TODO 2-й заход | later / опц.; визуал закрыт Write Gaps |
| 7h.POL | Тонкая политика реконнекта / backoff | plan out of scope | later |
| 7h.OPT | Каталог/подписка опционов FORTS (ATM ±N Online) | [phase7i/issue](../phase7i/issue.md) | **DONE** (2026-08-04) |
| 7h.DER | Старый «журнал для backfill» в 7h incident.md | superseded → phase 8 | снят |

---

## Phase 7i — Auto / Supervisor / расписание

**MVP:** Auto-тумблер, Supervisor, `recording_schedule`, `market_schedule` (+ UI), Integrations,
Scinverse confirmer (Finam/ISS приоритет). **Не MVP:**

| # | Что | Пояснение | Горизонт |
| - | --- | --------- | -------- |
| **7i.S1** | `/api/sessions` ← SCD-2 история `market_schedule` | Ось Ганта сейчас = дни из покрытия + **часы «сегодняшнего» ISS**; не версионированная БД. Scinverse API (Интеграции) — другой контур. | production; ось Ганта ок после WebGL |
| **7i.S2** | Daily-sync + pre-flight | С утра Finam/ISS ↔ база; расхождение → `market_schedule_exception` + warning | **production долг** |
| **7i.S3** | Бэкфилл / эмпирика регламента по свечам Finam | годы истории, `confidence=empirical` | production |
| 7i.L1 | Авто-connect / warmup до открытия | осознанно later (DLL) | later |
| 7i.L2 | Полный диалог политик, weekdays, US-tz, кастомные окна | полный plan vs apply-MVP | later |
| 7i.L3 | «Рыночный пульс» тумблера связи без записи | осознанно отложено | later |
| 7i.L4 | User-scope политик записи | phase 10 | Stage 2 |
| 7i.MAP | `system_source(capability, market, service_id)` вместо хардкод-дефолтов confirmer | schedule.md | later |
| 7i.OPT | Подписка на опционы TRANSAQ (цепочка команд) | [issue.md](../phase7i/issue.md) | **DONE** (= 7h.OPT, 2026-08-04) |

Канон: [../phase7i/schedule.md](../phase7i/schedule.md).

---

## Phase 7j — connection schedule / инциденты

Ядро инцидентов + Adopt — DONE. Остаток:

| # | Что | Статус / горизонт |
| - | --- | ----------------- |
| **7j.15** | Market/calendar profile (UI без хардкода MOEX) | очередь · [market-profile](../phase7j/market-profile.md) |
| **7j.16** | `date`-авторинг + пагинация календаря по месяцам | очередь · UX |
| **7j.22** | Host `Max Pool Size` (клиент I12 DONE; pool defer @100) | только если снова exhausted |
| **I9** | Prod checklist: bind / health / proxy family после Vite | OPEN ops |
| **J9 / J10** | per-connection grace / глобальный порог NC | план later |
| 7j.NC.UX | Мелочи NC из todo 7j («Найдено: N», layout, поиск↔corr) | Stage 2 / phase 11 |
| 7j.WEBGL | Клик по 1px-маркеру ribbon → фильтр NC по corr | после WebGL |

Канон: [../phase7j/todo.md](../phase7j/todo.md).

---

## Phase 8 — журнал OHS / schedule-projection

**DONE (Гант Connection / Writers, 2026-08):** журнал, soft-delete, crash fan-out, Connection-ribbon
из `incident`, **Schedule void mask** (`showScheduleMask$` + `scheduleVoidIntervals` на ribbon),
**ScheduleCutter** (Domain) + **Write Gaps** на Writers (`POST /write-gaps`, `showWriteGaps`).
P3–P5 crash/journal — DONE. Follow-up:

| # | Что | Статус | Горизонт |
| - | --- | ------ | -------- |
| **8.HD** | Hard-delete / retention purge `incident` | out of scope journal | later |
| 8.NC | Вынос atoms V025 / NC-сервис | не phase 8 | Stage 2 / phase 11 |
| 8.ILOG | `ILogger` → notification sink | out of scope (бывш. phase 11) | later |

Канон: [../phase8/plan-schedule-projection.md](../phase8/plan-schedule-projection.md) ·
[../phase7h/write-gaps.md](../phase7h/write-gaps.md).

---

## Сводка «сначала в production» (приоритетный долг)

1. **7i.S2** — daily-sync + pre-flight  
2. **7i.S1** — sessions/Гант ← SCD-2 `market_schedule` (после WebGL для оси — ок)  
3. **7i.S3** — бэкфилл эмпирики Finam  
4. **7j.15 / 7j.16** — market profile + пагинация календаря  
5. **WG.1** — backfill WriteGaps (история коннектора → `md_trade`)  
6. **I9** — prod checklist  

---

## Не Stage 1 (не дублировать сюда как «хвост 4–8»)

- Keycloak — phase 10 / Stage 2  
- NC split / MFE — phase 11 / Stage 2  
- WebGL / LOD — phase 12 / Stage 3  
- Cache / CI-CD — phase 13–14 / Stage 4  
- QScalp, Plaza2 — Future Features  

---

## Правила

1. Новые «не в MVP» хвосты фаз 4–8 — **только в этот файл**, статусы фаз не возвращать в IN PROGRESS.  
2. Ссылки из phase7*/phase8* — сюда.  
3. Имя файла: **`abandoned.md`** (единственный).
