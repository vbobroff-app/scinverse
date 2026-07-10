# Phase 7d. Отчёт о выполнении

Актуальный статус фазы 7d. Обновляется по мере выполнения задач из [plan.md](plan.md).

**Текущий статус:** `IN PROGRESS`. **Обновлено:** 2026-07-10.

## Статус задач

| #    | Задача | Статус | Комментарий |
| ---- | ------ | ------ | ----------- |
| 7d.1 | Backend: `InstrumentQuery` (`NonEmpty`/`InstrumentIds`/`Exchanges`) | TODO | следующий этап (оживление) |
| 7d.2 | Backend: SQL-фильтры в `InstrumentStore.QueryAsync` | TODO | |
| 7d.3 | Backend: резолвер бирж `ExchangeBoards` (задел, MOEX) | TODO | |
| 7d.4 | API `/api/instruments` + `IOhsApi` + `OhsApiClient` | TODO | |
| 7d.5 | core: `activeFilters$` + расширение `instrumentQuery$` + методы | DONE | `add/remove/clear`, `setCategory/setSelectionConditions/setExchanges` |
| 7d.6 | api.ts: сериализация новых полей + типы | DONE | `nonEmpty`/`instrumentIds`/`exchanges` (CSV) |
| 7d.7 | UI: `FilterChips`, поповеры, рефактор `FilterBar` | DONE | плашки + `[+]`/`[×]`, поиск справа с лупой; удалён `CategoryDropdown` |
| 7d.8 | Тесты (unit/api backend + vitest) | IN PROGRESS | vitest фильтров зелёный (12); backend — на этапе оживления |

## Лог выполнения

| Дата | Действие | Результат |
| ---- | -------- | --------- |
| 2026-07-10 | Убрана подсказка «Подключись, чтобы стартовать запись…» из `ProviderCard` | место сверху освобождено |
| 2026-07-10 | Заведена фаза 7d: план/apply/отчёт | документы готовы |
| 2026-07-10 | Фронт 7d.5–7d.7: модель фильтров в `OhsStore`, `FilterChips` + поповеры, рефактор `FilterBar` | tsc ok; vitest 12; удалён `CategoryDropdown` |

## Итог

_(заполняется по завершении фазы)_
