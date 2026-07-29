# Phase 7j — TODO (что осталось)

**Обновлено:** 2026-07-29.

Ядро фазы (**7j.17–7j.20** + **J11a/b/c** + **I10/I11**) по сценариям инцидентов — **код готов**.
Остаток 7j (не инциденты): **7j.15** / **7j.16**. NC лента Thread — **phase 11 DONE**;
журнал инцидентов — **11.13** таблица `incident` в **OHS** (atoms → NC на gate) — [../phase11/incident-journal.md](../phase11/incident-journal.md).

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
| **I10** | После crash/рестарта: adopt open break из V025; catch-up abandon вне окна | **КОД ГОТОВ**; Adopt атомарный (I11 B2) |
| **UI outage mask** | При crash open: тумблер «OHS недоступен» (жёлтый) + AUTO жёлтый | **КОД ГОТОВ** (`backendOutage$`) |
| **I6 regress** | ConnectAsync без ре-подписки → recovered без сделок | **КОД ГОТОВ** |
| **J9 / J10** | per-connection grace / глобальный порог NC | ПЛАН, позже ([incident.md](incident.md) §8) |
| **H1 / H2** | recording-ribbon бинарный под Degraded | → **7h** |
| **I9 prod** | bind/health/proxy family после Vite | OPEN checklist ([issue.md](issue.md) I9) |
| **I12** | Pool exhausted → пачка 500; orphan ACTIVE FATAL после recover | **OPEN** ([issue.md](issue.md) I12): RxJS sync refresh; смежно coverage 7h |

System-уведомления: JSON (`result`/`error_message`/`sender`); user schedule — `lines[]`.
