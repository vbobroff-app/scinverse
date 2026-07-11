# Phase 7f. Особенности реализации

Как устроен тайм-лайн-фильтр и стандарт времени. Общий план — в [plan.md](plan.md), статус — в
[report.md](report.md).

## 1. Ключевая идея: трансформация сессий в сторе

Вся отрисовка оси (подписи `TimeAxis`, колбаски/now-линия `CoverageTrack`) проецируется через
`makeProjector(window.from, window.to, sessions)` — т.е. полностью управляется парой `sessions$` +
`window$`. Поэтому тайм-лайн-фильтр реализован как **чистая клиентская трансформация набора сессий**
перед публикацией: ничего в компонентах отрисовки менять не пришлось.

Поток в `OhsStore`:

```
applyTimeframe → (генерация сессий recentSessions/sessionsFrom)
              → publishSessions(ordered)
                  → shapeSessions(ordered)         // фильтр дней недели + переразметка окна дня
                  → sessions$.next(shaped)
                  → setWindow(first.start … last.end)  // → refreshCoverage() подтянет данные окна
```

- `shapeSessions` отбрасывает дни, чьих дней недели нет в `timelineFilter.weekdays`, и переразмечает
  каждый оставшийся день через `reshapeDay`.
- `publishSessions` ставит окно по первому/последнему shaped-дню (в full-режиме окно шире → coverage
  перезапрашивается и ночные/внесессионные сделки попадают в выборку).

## 2. Модель (`types.ts`)

```ts
export type DayWindowMode =
  | { mode: 'full' }                                   // полные сутки 00:00–24:00
  | { mode: 'smart' }                                  // авто: одна биржа → её сессия, микс → full
  | { mode: 'session'; exchange: string }              // сессия площадки (сегодняшнее расписание)
  | { mode: 'custom'; fromMin: number; toMin: number };// окно t1–t2 (минуты от МСК-полуночи)

export interface TimelineFilter {
  weekdays: ReadonlySet<number>;   // 0=вс..6=сб
  dayWindow: DayWindowMode;
}

export interface DisplayTz {
  preset: 'utc' | 'msk' | 'custom';
  offsetMin: number;               // смещение от UTC, минуты (МСК = +180)
}
```

## 3. `OhsStore`

- **Стартовая нейтраль-фильтра:** `STARTUP_TIMELINE = { weekdays: все 7, dayWindow: session MOEX }`
  (по умолчанию — спроецированное текущее расписание MOEX). Сброс (`resetTimelineFilter`) → все дни
  + `full`.
- **`reshapeDay(session, dayWindow)`** — `switch` по режиму:
  - `session`/`smart` → возвращает сгенерированные границы как есть (в MVP это MOEX; для не-MOEX
    здесь TODO-хук пересчёта по расписанию `dayWindow.exchange`);
  - `full` → `[МСК-полночь, +24ч]`;
  - `custom` → `[полночь + fromMin, полночь + toMin]`.
  Полночь считается через `mskMidnightMsFromIso(date)`.
- **`resolveDayWindow(dw)`** — разворачивает `smart` в конкретный режим: `pickSmartExchange()` (одна
  выбранная биржа из `instrumentQuery.exchanges` → она; микс → `full`; ничего → `HOME_EXCHANGE`).
- **`genIncludeWeekends()`** — нужно ли генерировать выходные для счётчика сессий: `true`, если в
  наборе дней есть сб(6) или вс(0). Заменил прежний `tf.includeWeekends` (в UI больше не выставлялся).
- **`setDisplayTz(tz)`** — меняет `displayTz$` (перерисовка оси через проп `tzOffsetMin`).

## 4. Стандарт времени (единый на систему)

- Источник правды — `displayTz$` в сторе. Значение прокидывается в отрисовку как проп `tzOffsetMin`
  (через `InstrumentPicker` → `TimeAxis` и каждый `CoverageTrack`), а не через глобальную константу.
- В `TimeAxis`/`CoverageTrack` захардкоженный `MSK_MS` убран; форматирование обобщено:
  `tzDateOf(ms, offsetMin)` (`moexSession.ts`), локальные `hmTz`/`dmTz`/`midnightTz`/`isoTz`/`stampTz`.
- **Сессии остаются в своих ТЗ** — стандарт времени меняет только вывод (подписи/тултипы), не границы
  сессий. Подписи дней в посессионной шкале берут `session.date` (дата площадки), не пересчитываются
  в display-tz.

## 5. UI

- **`SessionFilter`** (`[+]` + поповер) вложен в `TimeframePanel` — общий контейнер `.panel` с
  чипами `[Диапазон][D1][All]`. Поповер раскрывается вверх (панель внизу экрана).
  - Секция «Дни»: заголовок-строка, пресеты + календари бирж, сетка тумблеров Пн–Вс.
  - Секция «Окно дня»: `[Full][🕐 moex][🕐 cme]`, ниже `[Расписание][Smart]`; при `custom` —
    панель time-picker; при `smart` — ряд дат-точных расписаний (плейсхолдеры).
  - `[+]` активен (`triggerActive`), когда `dayWindow ≠ full` или выбраны не все дни.
- **`HeaderControls`** — правый кластер шапки: живые часы (тик 1с, формат `HH:MM:SS` + ярлык ТЗ) +
  иконочный переключатель темы + шестерёнка настроек (поповер вниз) со стандартом времени. Заменил
  `ThemeToggle` (удалён).
- **`icons.tsx`** — общие монохромные SVG (`CalendarIcon` filled/Phosphor, `ClockIcon` feather),
  наследуют `currentColor`. Используются в `SessionFilter` и `TimeframePanel` («Диапазон»), чтобы
  иконки были из одного набора (эмодзи 🗓/🕐 давали разнокалиберный вид).

## 6. Выравнивание оси и колбасок

Ось (`.axisCell`) и дорожки (`.right`/`.track`) должны совпадать по X:

- под скроллбар списка — `.scroll { scrollbar-gutter: stable }` + правый отступ `.axisBar`;
- под бордеры — `.axisCell` padding = `spacing-md + 2px` (border `.right` + border `.track`);
- крайние метки оси: `left%` только у штриха, `translateX(-50%)` — только у подписи (штрих на точной
  позиции, label центрируется под ним, как средние).

## 7. Ограничения MVP (что не «настоящее»)

- `session`/`smart` для не-MOEX не пересчитывают границы по чужому расписанию (нет данных календаря).
- Календари/`history`/`Set schedule` — disabled-плейсхолдеры (реализация в 7c и позже).
- Режим `All` — линейный, окно дня не применяется.
- Проекция долей — пропорциональна длительности (как 7b), не равными долями.
