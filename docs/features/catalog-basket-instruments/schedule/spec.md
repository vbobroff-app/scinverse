# catalog-basket-instruments / schedule

**Часть фичи:** единое расписание связи и записи. Индекс — [`../main.md`](../main.md).

Статус: **DRAFT** (2026-08-07). Код единого окна ещё не сведён; connection schedule
(as-is) уже несёт нужную модель «день открытия».

Смежное: [`../life-cycle/`](../life-cycle/spec.md) (checkup day) ·
[`ConnectionScheduleResolver`](../../../../services/online-history-server/src/Scinverse.Ohs.Domain/ConnectionScheduleResolver.cs) ·
календарь ISS ([phase7c](../../../dev/phase7c/apply.md)).

---

## 1. Зачем

Сейчас два независимых Auto:

| Контур | Что включает |
|--------|----------------|
| Connection schedule | быть на связи с data-сервером (Finam/TRANSAQ) |
| Recording schedule | Auto-запись по инструментам |

Оператор держит два тумблера/окна. Ночной хвост сессии (до ~01:00) и утренний старт
(~06:00) требуют одного понятия «сутки открытия» — иначе checkup и Auto расходятся.

**Канон to-be:** одно расписание → Auto connection = Auto writing.

```text
единое окно (день открытия + OpenTime + duration, через полночь ок)
  → связь с data-сервером
  → запись working set (Observed / ☑ Recording)
```

Ручной Start вне окна — остаётся (точечная запись).  
История расписания / аудита правил — **отдельная тема** (не этот документ).

---

## 2. As-is: connection schedule (уже есть)

Механизм формирования **текущего** окна связи готов и остаётся основой единого schedule.

### 2.1 Модель

- Правила: уровни `main` / `dow` / `date`, победитель = уровень → свежесть.
- Сессия принадлежит **дню открытия**: окно `[open, open+duration)` может уходить за полночь
  как хвост той же сессии (пример: 06:00 → 01:00 следующего календарного дня).
- `mode=off` — сессии нет; `main` дополнительно гейтится торговым днём календаря.
- Резолвер: `ConnectionScheduleResolver.IsConnectDesired` / `ResolveSession`.

### 2.2 Календарь

- Торговый день: ISS / `IMarketCalendar` (фолбэк `MoexSchedule`).
- Intraday «в сессии прямо сейчас» для бумаги — отдельная ось (`sec_status`), не schedule.

### 2.3 Recording Auto (as-is, отдельно)

- Per-instrument `RecordingSchedule` + supervisor ticks.
- Не привязан жёстко к connection open-day — это и есть долг сведения.

---

## 3. To-be: единое расписание

| Тема | Решение |
|------|---------|
| Один источник окна | Connection schedule (правила + календарь) — канон формирования |
| Auto connection | как сейчас: desired по окну дня открытия |
| Auto writing | то же окно: писать инструменты Observed с intent записи (system Recording / Auto on) |
| Ручной Start | вне/внутри окна — оператор может писать точечно |
| Checkup day | = день открытия окна (сейчас interim: cutover 06:00 МСК в life-cycle) |
| История правил | out of scope этой спеки — отдельный контур (listHistory уже есть у connection; продукт истории later) |

**Формирование и «текущее»** — один механизм (resolver + calendar).  
**История** (что было вчера / аудит изменений) — не смешивать с live desired.

---

## 4. Связь с life-cycle

Пока единого schedule в коде нет, checkup использует interim:

- граница суток checkup = **≥ 06:00 МСК** (`InstrumentLifecycle.CheckupDayMoscow`);
- первый успешный connect в checkup-сутки → Checkup NC.

После внедрения этой части: cutover / checkup day брать из `OpenTime` единого окна
(типично тот же 06:00), без второго хардкода.

---

## 5. Scope / out of scope

| В scope | Вне |
|---------|-----|
| Канон Auto connection = Auto writing | Полноценный UI истории расписания |
| Опереться на as-is connection rules + calendar | Intraday sec_status |
| Перенос checkup day на open-day окна | Dynamic baskets / ATM |
| Документ as-is ↔ to-be | Отдельная фича «schedule history» |

---

## 6. Acceptance (черновик)

1. Одно окно управляет желаемой связью и желаемой Auto-записью Observed.
2. Хвост после полуночи (00:30) — тот же день открытия, что утренний 06:00; checkup не дублируется.
3. Ручной Start не ломается.
4. Календарь (неторговый день) по-прежнему гасит `main`, как у connection as-is.
