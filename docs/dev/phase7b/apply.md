# Phase 7b. Особенности реализации

Конкретные решения фазы 7b. Обзор — в [plan.md](plan.md), статус — в [report.md](report.md).

## 1. Расписание сессий MOEX (`MoexSchedule`, Domain)

Часы ЕТС — константы (МСК = UTC+3, без DST). Тип дня определяется по `DayOfWeek`.

```csharp
public sealed record TradingSession
{
    public required DateOnly Date { get; init; }
    public required DateTimeOffset Start { get; init; }
    public required DateTimeOffset End { get; init; }
    public required bool Weekend { get; init; }
}

public static class MoexSchedule
{
    private static readonly TimeSpan Msk = TimeSpan.FromHours(3);
    // будни 08:50–23:50; выходные ДСВД 10:00–19:00
    public static TradingSession Session(DateOnly date) { /* по DayOfWeek */ }
}
```

- Возвращаем `DateTimeOffset` со смещением `+03:00`, чтобы фронт корректно позиционировал
  now-линию и границы окна независимо от локали браузера.
- Праздники не моделируем: реальные торговые дни приходят из данных (см. §2), `MoexSchedule` лишь
  раздаёт часы для конкретной даты.

## 2. Торговые дни из данных (`CoverageStore.QueryTradingDaysAsync`)

```sql
SELECT DISTINCT (ts AT TIME ZONE 'Europe/Moscow')::date AS day
FROM md_trade
-- при includeWeekends=false отбрасываем сб/вс
WHERE (@includeWeekends OR EXTRACT(ISODOW FROM (ts AT TIME ZONE 'Europe/Moscow')) < 6)
ORDER BY day DESC
LIMIT @count;
```

- `Europe/Moscow` — фиксированный UTC+3; берём именно дату сессии (ЕТС синхронизирован с
  календарным днём, вечерняя сессия относится к текущему дню).
- Дни возвращаются свежими вперёд; на каждый день фронт/бэк накладывает `MoexSchedule.Session`.
- Дорого сканировать `md_trade` целиком — полагаемся на индекс по `ts`; при росте объёма заменим
  на continuous aggregate (Stage read-path).

## 3. Экстент покрытия (`CoverageStore.QueryCoverageExtentAsync`)

```sql
SELECT min(started_at) AS from_ts,
       max(coalesce(ended_at, now())) AS to_ts
FROM coverage_segment
WHERE (@sourceId IS NULL OR source_id = @sourceId);
```

Пустой результат (нет сегментов) → фронт откатывается на `D1`.

## 4. API и контракт

`Dtos.cs`:

```csharp
public sealed record SessionDto(DateOnly Date, DateTimeOffset Start, DateTimeOffset End, bool Weekend);
public sealed record CoverageExtentDto(DateTimeOffset? From, DateTimeOffset? To);
```

`IOhsApi` / `OhsEndpoints`:

- `GET /api/sessions?count={n}&includeWeekends={bool}` → `SessionDto[]` (часы из `MoexSchedule`).
- `GET /api/coverage/extent?sourceId={id?}` → `CoverageExtentDto`.

Обновляются тестовый клиент `OhsApiClient` и фейковый стор покрытия (api-тесты).

## 5. core: модель таймфрейма и стор

```ts
export type Timeframe =
  | { kind: 'sessions'; unit: 'D' | 'W' | 'M' | 'Q' | 'Y'; count: number; includeWeekends: boolean }
  | { kind: 'all' }
  | { kind: 'range'; from: string; to: string };
```

`OhsStore`:

- `timeframe$` (default `{ kind:'sessions', unit:'D', count:1, includeWeekends:false }`),
  `sessions$` (границы для сепараторов), `includeWeekends$`.
- `setTimeframe(tf)` — считает окно и кладёт в `window$` + `refreshCoverage`:
  - `sessions/D/W` → `getSessions(countSessions, includeWeekends)`, окно `[first.start, today.end]`;
  - `M/Q/Y` → календарный сдвиг назад, левый край привязать к ближайшей сессии;
  - `all` → `getCoverageExtent`;
  - `range` → как есть, привязка к границам сессий.
- Замена `maybeAdvanceWindow`: низкочастотный таймер (30–60с) для live-таймфреймов
  пере-вычисляет окно при смене сессии/суток; now-линия по-прежнему через `useNow`.
  Для `range`/`all` окно фиксировано (таймер ничего не делает).
- Poll покрытия (12с) сохраняется — живые гэпы.

## 6. UI: панель + компоновка + сепараторы

- `TimeframePanel`: одна кнопка-триггер (подпись = текущий выбор, напр. `D1`) открывает **общее
  меню группами** `Дни D1–D30 / Недели W1–W4 / Месяцы M1–M12 / Кварталы Q1–Q4 / Годы Y1–Y10`
  (мелкие плашки, активная подсвечена). Рядом чипы `All` и `🗓 Диапазон`, чекбокс «выходные».
  Меню и календарь раскрываются **вверх** (`bottom: 100%`), т.к. панель внизу экрана.
- `InstrumentPicker`: низ = строка `[TimeframePanel] [TimeAxis]` в той же grid-сетке, пагинатор —
  отдельной строкой ниже (откат слияния футера и оси).
- Сепараторы сессий: `CoverageTrack`/`TimeAxis` рисуют вертикальные линии на `session.start`
  из `sessions$` (позиция через тот же `pct(t)`), подпись даты сессии на оси.

## 7. Тесты

- **unit** `MoexScheduleTests`: будний день → 08:50–23:50 (+03:00); суббота → 10:00–19:00, `Weekend`.
- **integration** `CoverageStoreTests`: `QueryTradingDaysAsync` (фильтр выходных, LIMIT, порядок);
  `QueryCoverageExtentAsync` (min/max, пусто).
- **vitest** `OhsStore`: `setTimeframe` для `D1`/`W1`(5 vs 7)/`range`/`all` → корректные границы
  `window$` (fake timers, замоканный api).
