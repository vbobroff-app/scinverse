# Фаза 1. Миграция V003 (derivative + instrument_risk) — подробный план

**Цель.** Аддитивной миграцией `V003` добавить две таблицы под деривативы согласно **Решению 2**
из [`../../architecture/db-design.md`](../../architecture/db-design.md):

- `derivative` — атрибуты контракта FUT/OPT (1:1 с `instrument`, подтип-таблица);
- `instrument_risk` — волатильные риск-параметры (ГО/лимиты) с историей (темпоральная таблица).

## Исходное состояние (предусловия)

- Фаза 0 завершена: `V001`+`V002` накатаны, мигратор (`db/Scinverse.Db.Migrator`, DbUp) рабочий.
- `instrument` существует (на него ссылаются обе новые таблицы, включая self-FK `underlying_id`).
- Объём фазы ограничен: **только миграция `V003`**. `source_id`/`instrument_alias`/OrderLog (Решения
  3 и 5) — Фаза 2. Заполнение таблиц из коннектора и доменные типы C# — вне этой фазы.

## Задачи

| #   | Задача                                                                       | Тип        |
| --- | ---------------------------------------------------------------------------- | ---------- |
| 1.1 | Написать `db/migrations/V003__derivative_and_risk.sql` (derivative + index + instrument_risk) | правка |
| 1.2 | Накатить: `dotnet run --project db/Scinverse.Db.Migrator`                     | выполнение |
| 1.3 | Верифицировать схему: таблицы, FK (вкл. self-FK), индекс, запись `V003` в журнале | проверка   |
| 1.4 | Обновить статус Решения 2 в `db-design.md` (`PLANNED (V003)` → `DONE`)        | правка     |

## Результаты (deliverables)

- Файл миграции `V003__derivative_and_risk.sql` (embedded в мигратор).
- Применённая на локальной TimescaleDB схема: `derivative`, `instrument_risk`, индекс
  `ix_derivative_chain`; третья запись в `schemaversions`.
- Обновлённый [report.md](report.md) с фактическим статусом и логом.

## Критерии приёмки

1. `dotnet run --project db/Scinverse.Db.Migrator` завершается кодом `0`; применён ровно один новый
   скрипт (`V003`).
2. В БД присутствуют `derivative` и `instrument_risk` с корректными PK/FK:
   - `derivative`: PK `instrument_id` (FK → `instrument`), self-FK `underlying_id` → `instrument`,
     индекс `ix_derivative_chain (underlying_id, expiration, strike)`.
   - `instrument_risk`: составной PK `(instrument_id, valid_from)`, FK → `instrument`.
3. Повторный прогон идемпотентен (0 новых скриптов).
4. `dotnet build Ohs.sln` — без ошибок (изменения только SQL, регрессий быть не должно).
5. Статус Решения 2 в `db-design.md` переведён в `DONE`.

## Вне объёма фазы

- `data_source` / `instrument_alias` / `source_id` в PK фактов — Фаза 2 (вариант A).
- `md_orderlog` / `md_book_snapshot` (OrderLog, Решение 5) — Фаза 2.
- C#-доменные типы для деривативов и их заполнение из коннектора TRANSAQ.
- Перевод `instrument_risk` в hypertable (решается по фактической частоте обновления ГО).
