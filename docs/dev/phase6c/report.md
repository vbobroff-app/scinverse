# Phase 6c. Отчёт о выполнении

Актуальный статус фазы 6c. Обновляется по мере выполнения задач из [plan.md](plan.md).

**Текущий статус:** `DONE` (backend). **Обновлено:** 2026-07-10.

## Статус задач

| #    | Задача | Статус | Комментарий |
| ---- | ------ | ------ | ----------- |
| 6c.1 | `IDerivativeSpecParser` + разбор кодов FORTS | DONE | `MoexFortsSpecParser` (Domain), FUT/OPT формы |
| 6c.2 | `SecurityInfo` += expiration/option_type/strike/underlying | DONE | обогащение в `InstrumentRegistry` |
| 6c.3 | Write-path: наполнение `derivative` (+ `V007`) | DONE | `underlying_id` best-effort, `underlying_code` всегда |
| 6c.4 | Read-model группировки + эндпоинт `/api/instruments/groups` | DONE | `QueryGroupsAsync` (underlying/series) |
| 6c.5 | Фильтры листа (`underlyingCode`/`expiration`) | DONE | LEFT JOIN derivative в `QueryAsync` |
| 6c.6 | Синтетический FORTS-набор | DONE | `SampleData`: SiU6 + опционная серия |
| 6c.7 | Тесты (unit/integration/api) | DONE | парсер + derivative-store/группировка + groups-эндпоинт |

## Открытые пункты (live-verify)

- Точные теги TRANSAQ для деривативов (`sec_info`: `mat_date`, `put_call`) и реальный формат
  опционных кодов подтверждаются захватом с живого коннектора (см. [phase7/issue.md](../phase7/issue.md) п.4).
  Текущий парсер детерминирован на формах `SiU6` / `SiU6C65000`; нераспознанные коды → инструмент
  остаётся «плоским» (без строки `derivative`).

## Лог выполнения

| Дата | Действие | Результат |
| ---- | -------- | --------- |
| 2026-07-09 | Заведена фаза: план/спецификации/отчёт; зафиксирован issue phase7 | Документы готовы |
| 2026-07-10 | Реализация: парсер FORTS, обогащение, `V007`, write `derivative`, read-model групп, фильтры цепочки, синтетика, тесты | build/тесты — см. верификацию |
| 2026-07-10 | Верификация: `DateOnlyTypeHandler` (Dapper не знает `DateOnly`), `::date`-каст для nullable-фильтра, гермётичность api-тестов (подмена `NpgsqlDataSource` на контейнер) | build 0/0; тесты 26+9+5 зелёные |

## Следующий шаг

Возврат в phase7: переключатель «Список ↔ Дерево» + компонент дерева (underlying → series → strikes).
