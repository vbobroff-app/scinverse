# Phase 7d. Отчёт о выполнении

Актуальный статус фазы 7d. Обновляется по мере выполнения задач из [plan.md](plan.md).

**Текущий статус:** `IN PROGRESS`. **Обновлено:** 2026-07-10.

## Статус задач

| #    | Задача | Статус | Комментарий |
| ---- | ------ | ------ | ----------- |
| 7d.1 | Backend: `InstrumentQuery` (`NonEmpty`/`InstrumentIds`/`Exchanges`) | DONE | поля добавлены в Domain + Contracts DTO |
| 7d.2 | Backend: SQL-фильтры в `InstrumentStore.QueryAsync` | DONE | `nonEmpty` (EXISTS cs), `instrumentIds`/`boards` = ANY(...) |
| 7d.3 | Backend: резолвер бирж `ExchangeCatalog.BoardsFilter` (задел, MOEX) | DONE | MOEX ⇒ null (no-op); не-MOEX ⇒ пусто |
| 7d.4 | API `/api/instruments` + `IOhsApi` + `OhsApiClient` | DONE | новые query-параметры + `ParseCsv`/`ParseLongs` |
| 7d.5 | core: `activeFilters$` + расширение `instrumentQuery$` + методы | DONE | `add/remove/clear`, `setCategory/setSelectionConditions/setExchanges` |
| 7d.6 | api.ts: сериализация новых полей + типы | DONE | `nonEmpty`/`instrumentIds`/`exchanges` (CSV) |
| 7d.7 | UI: `FilterChips`, поповеры, рефактор `FilterBar` | DONE | плашки + `[+]`/`[×]`, поиск справа с лупой; удалён `CategoryDropdown` |
| 7d.8 | Тесты (unit/api backend + vitest) | IN PROGRESS | vitest 12 + unit 52 зелёные; api-тесты фильтров написаны, прогон требует остановки живого Host + Docker |

## Лог выполнения

| Дата | Действие | Результат |
| ---- | -------- | --------- |
| 2026-07-10 | Убрана подсказка «Подключись, чтобы стартовать запись…» из `ProviderCard` | место сверху освобождено |
| 2026-07-10 | Заведена фаза 7d: план/apply/отчёт | документы готовы |
| 2026-07-10 | Фронт 7d.5–7d.7: модель фильтров в `OhsStore`, `FilterChips` + поповеры, рефактор `FilterBar` | tsc ok; vitest 12; удалён `CategoryDropdown` |
| 2026-07-10 | UI-правки: `[+]` слева / `[×]` за плашками, крестик плашки не красный, «Инструменты» → «Инструмент» | по фидбеку |
| 2026-07-10 | Бэкенд 7d.1–7d.4: `InstrumentQuery`+DTO, SQL-фильтры, `ExchangeCatalog`, endpoint+клиент, api-тесты | build CS-clean; unit 52; api-тесты ждут остановки живого Host |
| 2026-07-10 | Фикс 500 на `/instruments`: null-массивы `@instrumentIds`/`@boards` → непустые массивы + булевы флаги применения | Npgsql не выводит тип null-массива |

## Итог

_(заполняется по завершении фазы)_
