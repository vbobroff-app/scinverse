# Фаза 0. Инфраструктура миграций — подробный план

**Цель.** Накатить существующие SQL-миграции на реальную TimescaleDB из `docker-compose`, обеспечить
воспроизводимость (пиннинг образа) и удобный запуск. Это фундамент, на который встанут все
последующие миграции (Фаза 1+).

## Исходное состояние (что уже есть)

- **Мигратор реализован:** `db/Scinverse.Db.Migrator` — консольное приложение на DbUp.
  - `DatabaseMigrator.Run(connectionString)` — `EnsureDatabase` + прогон **embedded** скриптов
    `db/migrations/V*.sql`, `LogToConsole`.
  - `Program.cs` — точка входа; строка подключения из `args[0]` → env `SCINVERSE_DB` → дефолт
    `Host=localhost;...;Database=scinverse;Username=scinverse;Password=scinverse`.
  - csproj embed'ит `..\migrations\*.sql`.
  - Уже используется интеграционными тестами (`TimescaleFixture`) — то есть механизм рабочий.
- **Миграции:** `V001__reference.sql` (market/board/instrument), `V002__market_data_trades.sql`
  (`md_trade` hypertable + индекс).
- **Compose:** сервис `timescaledb` (`timescale/timescaledb:latest-pg16`), БД/юзер/пароль
  `scinverse`, порт `5432`, healthcheck, том `scinverse_pgdata`.

Вывод: строить мигратор **не нужно**. Остаётся выполнить накат, закрепить версию образа и добавить
обвязку.

## Задачи

| #   | Задача                                                                                   | Тип        |
| --- | ---------------------------------------------------------------------------------------- | ---------- |
| 0.1 | Пиннинг образа в `docker-compose.yml` (`latest-pg16` → `2.17.2-pg16`, паритет с тестами) | правка     |
| 0.2 | Поднять TimescaleDB: `docker compose up -d`, дождаться healthy                            | выполнение |
| 0.3 | Прогнать мигратор против compose-БД (`dotnet run` / env `SCINVERSE_DB`)                   | выполнение |
| 0.4 | Верифицировать схему: таблицы, hypertable, журнал `schemaversions`, идемпотентность повтора | проверка   |

Обвязка запуска — стандарт `docker compose up -d` + `dotnet run` (CLI-мигратор уже есть); отдельный
сервис/скрипт не заводим (см. [apply.md](apply.md)).

## Результаты (deliverables)

- `docker-compose.yml` с закреплённой версией образа.
- Применённые `V001`, `V002` на локальной TimescaleDB; таблица журнала `schemaversions` с двумя
  записями.
- Обновлённый [report.md](report.md) с фактическим статусом и логом выполнения.

## Критерии приёмки

1. `docker compose up -d` поднимает TimescaleDB до состояния healthy.
2. Прогон мигратора завершается кодом `0` и сообщением «Миграции применены успешно».
3. В БД присутствуют `market`, `board`, `instrument`, `md_trade` (как hypertable), индекс
   `ix_md_trade_instrument_ts`, расширение `timescaledb`.
4. Повторный прогон мигратора — **идемпотентен** (0 применённых скриптов, DbUp пропускает по журналу).
5. Версия образа в compose совпадает с версией в интеграционных тестах.

## Вне объёма фазы

- `V003` (derivative + instrument_risk) — Фаза 1.
- `source_id` / `data_source` / `instrument_alias` / `md_orderlog` — Фаза 2 (вариант A, позже).
- Изменения C#-конвейера — Фаза 2+.
