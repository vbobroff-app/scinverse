# Phase 7b. Отчёт о выполнении

Актуальный статус фазы 7b. Обновляется по мере выполнения задач из [plan.md](plan.md).

**Текущий статус:** `PLANNED`. **Обновлено:** 2026-07-10.

## Статус задач

| #    | Задача | Статус | Комментарий |
| ---- | ------ | ------ | ----------- |
| 7b.1 | `MoexSchedule` + `TradingSession` (Domain) | TODO | часы сессии по типу дня |
| 7b.2 | `QueryTradingDaysAsync` (из `md_trade`) | TODO | DISTINCT даты МСК, фильтр выходных |
| 7b.3 | `QueryCoverageExtentAsync` | TODO | min/max по `coverage_segment` (All) |
| 7b.4 | API `/api/sessions`, `/api/coverage/extent` + контракт/клиент/фейки | TODO | `SessionDto`/`CoverageExtentDto` |
| 7b.5 | core: `Timeframe`, `getSessions`/`getCoverageExtent`, `OhsStore` | TODO | сессионный пересчёт окна |
| 7b.6 | UI `TimeframePanel` (дропдауны/All/выходные/даты) | TODO | по образцу `CategoryDropdown` |
| 7b.7 | UI компоновка: `[таймфрейм][ось]` + пагинатор отдельно | TODO | откат слияния футера/оси |
| 7b.8 | UI сепараторы сессий | TODO | линии по `sessions$` |
| 7b.9 | Тесты (unit/integration/vitest) | TODO | schedule/sessions/extent + timeframe→window |

## Открытые пункты

- Часы ЕТС и торговля в выходные подтверждены по moex.com (ЕТС с 23.03.2026: будни 08:50–23:50,
  ДСВД 10:00–19:00). Торговые дни берём из данных — праздничный календарь MOEX не заводим.
- Маппинг `M/Q/Y` — календарный (в отличие от посессионных `D`/`W`); при необходимости переведём
  всё в «число сессий».

## Лог выполнения

| Дата | Действие | Результат |
| ---- | -------- | --------- |
| 2026-07-10 | Заведена фаза 7b: план/apply/отчёт; уточнены часы сессий MOEX (ЕТС) | Документы готовы |

## Следующий шаг

Реализация по порядку 7b.1 → … → 7b.9 (см. [plan.md](plan.md)).
