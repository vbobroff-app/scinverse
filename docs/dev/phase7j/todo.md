# Phase 7j — TODO (что осталось)

**Обновлено:** 2026-08-04. Stage 1 **MVP DONE** — остаток вынесен в
**[abandoned](../../stage1/abandoned.md)** §7j.

Ядро фазы (**7j.17–7j.20** + **J11a/b/c** + **I10/I11**) — **код + живая приёмка** (Adopt 2026-07-31).
**I12 / 7j.22** — клиент **DONE**; Host pool **DEFER**. Журнал OHS — [../phase8/incident-journal.md](../phase8/incident-journal.md).
Итог модели — [../../stage1/incident-model-wrapup.md](../../stage1/incident-model-wrapup.md).

---

## Остаток в 7j (не блокирует инциденты)

### 7j.15 · Рынок / календарный профиль

UI пресетов захардкожен под MOEX; рынок (CME и др.) должен быть в модели без привязки к каждому правилу.

**План:** [market-profile.md](market-profile.md) — профиль на `ScheduleSettings`; правила нейтральны.

### 7j.16 · `date`-авторинг + пагинация графика по месяцам

Сейчас static/confirm-календарь рисует непрерывный диапазон одной лентой (при >14 колонках — только число дня).

**Сделать (позже):**

- диапазоны **> 1 мес** — пагинация по месяцам (edit static + confirm);
- полупрозрачный chrome по краям — листание соседнего месяца;
- явный контроль «какой месяц сейчас на графике».

**Пока:** полная лента + уплотнение подписей.

---

## Мелочи UI NC → уезжают в phase 11

Не блокируют 7j; часть перекроется Thread UI (11.10):

- показывать общее количество уведомлений в доке («Найдено: N» / всего)
- NC на всю область (layout)
- поиск не должен сбрасывать все фильтры при клике по `corr`
- **FUTURE (WebGL):** клик по 1px-маркеру Connection-ленты → фильтр NC по `correlationId`
  без сброса остальных — [incident.md](incident.md) §7.1

---

## Хвосты инцидентов (мелкие / позже)

| # | Что | Статус |
|---|-----|--------|
| **J11a** | `break` + `abandoned_schedule` | **DONE** (`368bfb9`) |
| **J11c** | `crash` + `abandoned_schedule` (клиент orchestrate + Host Release/ribbon) + optimistic ribbon overlay | **КОД ГОТОВ** (working tree 2026-07-27; закоммитить в чате phase11 или отдельно) |
| **I11 / 7j.21** | Рассинхрон Manager↔Hub; единый close-break; атомарный Adopt; снять костыли `auto:`/лента | **КОД ГОТОВ** — живая приёмка ([issue.md](issue.md) I11) |
| **J11b** | `abandoned_manual` (ручной off при open break) — часть I11 close-break | **КОД ГОТОВ** (I11 B1) |
| **I10** | После crash/рестарта: adopt open break; stale-close только Live | **ПРИНЯТО** 2026-07-31 ([issue.md](issue.md) I10) |
| **UI outage mask** | При crash open: тумблер «OHS недоступен» (жёлтый) + AUTO жёлтый | **КОД ГОТОВ** (`backendOutage$`) |
| **I6 regress** | ConnectAsync без ре-подписки → recovered без сделок | **КОД ГОТОВ** |
| **J9 / J10** | per-connection grace / глобальный порог NC | ПЛАН, позже ([incident.md](incident.md) §8) |
| **H1 / H2** | recording = бинарная проекция `incident`; Degraded рвёт capture | **DONE** · [incident §7](incident.md) |
| **I9 prod** | bind/health/proxy family после Vite | OPEN checklist ([issue.md](issue.md) I9) |
| **I12 / 7j.22** | Pool exhausted → пачка 500; orphan ACTIVE FATAL | **КЛИЕНТ DONE** (1)(2); (3) pool defer @100 · [plan.md](plan.md) §7j.22 · [issue.md](issue.md) I12 |

System-уведомления: JSON (`result`/`error_message`/`sender`); user schedule — `lines[]`.
