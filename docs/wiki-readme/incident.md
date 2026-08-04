# Инциденты

> **To-be идеология (канон):** [`docs/dev/phase11/schedule-projection.md`](../dev/phase11/schedule-projection.md)  
> Журнал `incident` (as-is + миграция): [`incident-journal.md`](../dev/phase11/incident-journal.md)  
> Слои T/C/W: [`layers.md`](layers.md) · разрывы записи: [`write-gaps.md`](write-gaps.md) ·
> Crash (as-is): [`crash-dispatch.md`](../dev/phase11/crash-dispatch.md) ·
> Break/crash продюсер: [`docs/dev/phase7j/incident.md`](../dev/phase7j/incident.md)

---

## 1. Определение (to-be)

**Инцидент** — зарегистрированный факт сбоя, который **влияет или мог повлиять на данные /
доступность** (crash Host, break link, релевантный 500 и т.п.).

Ключевые правила:

1. Факт пишется **честно и независимо от расписания**. Расписание **не классифицирует**,
   является ли событие инцидентом.
2. Расписание — **проекция / маска** поверх фактов (UI void + Cutter для writers), а не
   фильтр «писать / не писать в журнал».
3. Ручной disconnect / плановый Auto-stop по `desired` — **норма**, не инцидент
   (на ганте — серая / masked зона, не цветной эпизод).

| Ситуация | Журнал `incident` | NC | UI при включённой маске |
|----------|-------------------|----|-------------------------|
| Crash / break / data-affecting failure | **да** (полный span) | **Incident** | поверх — void вне schedule |
| Вне окна расписания тот же сбой | **да** (тот же факт) | **Incident** | маска гасит видимость на треке |
| Ручной / плановый стоп | нет | нет / info | серое / void |

**As-is (устаревает):** «инцидент только в горизонте / при живом коннекторе; вне окна — Group
без журнала». Это классификация по schedule — уходит по плану миграции.

---

## 2. Жизненный цикл

```text
сбой (fatal / error / transport down)
  → open: строка journal + NC Incident (+ маркеры на Connection-гант)
  → стек corr на ганте: цветная лента от open до close
  → close:
       • recovered / health-ok / link restored  → resolve
       • (to-be) schedule НЕ режет и НЕ закрывает факт
```

- Открытый инцидент → 1px маркер + цветной стек на Connection-гант; tooltip = текст уведомления.
- **Стек инцидента** — лента (жёлтая / красная / штрих) от открытия до закрытия.
- Плановый Auto disconnect по расписанию **не** должен «оборвать» факт как `abandoned_schedule`
  в новой модели (эта ветка выключается после переключения на Cutter/mask).

---

## 3. Виды

```text
Инциденты
│
├── BREAK (обрыв связи) — per connection
│   ├── Degraded (owner = connector)
│   └── Down (owner = supervisor)
│
└── CRASH (падение / авария)
    ├── Host Unavailable (stop / restart) — концептуально transport; journal → scope connections
    ├── Exception 500 (необработанное)
    ├── Out of Memory
    └── Out of Disk Space
```

**P5 (2NF):** один факт crash + таблица scope `incident_connection` (corr без `:c{id}`).
Cutover истории NC — purge `notification` + Host restart (без dual-read).

---

## 4. Owner и sender

- **Owner** — кто отвечает за восстановление.
  - Break Degraded → `transaq` / connector; при `server_status=down` или таймауте T → `supervisor`.
  - Crash → обычно `admin` / platform.
- На ганте: Degraded = жёлтая лента, Down / crash = красная / штрих.
- **Sender** — кто сообщил (client / host / connector); не путать с owner.

---

## 5. Связь с расписанием (кратко)

| Механизм | Что делает | Не путать с |
|----------|------------|-------------|
| **Schedule void mask** | UI: чёрная (~0.8) маска вне desired на Connection-треке | SessionFilter Full/moex (схлопывает **ось**) |
| **ScheduleCutter** | Writers: `gaps ∩ desired` без различия crash/break | классификации Incident vs Group |
| **Supervisor Auto** | connect/disconnect по `desired` | логикой «это инцидент или нет» |

Подробно — [schedule-projection.md](../dev/phase11/schedule-projection.md).

---

## 6. Z-order Connection-ганта (to-be)

Снизу вверх:

1. `link_liveness` (голубое / серое)
2. break
3. crash
4. маркеры 1px
5. **Schedule Mask** (верх)

Liveness и инциденты в антифазе; маска одна на весь трек — не режем только красное, оставляя
голубые хвосты вне окна.
