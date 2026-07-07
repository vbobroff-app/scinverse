# Фаза 0. Особенности реализации и спецификации

Технические детали инфраструктуры миграций: как устроен мигратор, конвенции, команды запуска и
подводные камни. Опирается на фактический код `db/Scinverse.Db.Migrator`.

## Компоненты

| Компонент | Путь | Роль |
| --------- | ---- | ---- |
| Мигратор (библиотека+CLI) | `db/Scinverse.Db.Migrator/` | прогон DbUp-миграций |
| SQL-миграции | `db/migrations/V*.sql` | схема БД (embedded в мигратор) |
| Локальная БД | `docker-compose.yml` (сервис `timescaledb`) | TimescaleDB для дева |
| Тестовый прогон | `tests/…/TimescaleFixture.cs` | накат в эфемерный контейнер (Testcontainers) |

## Мигратор (DbUp)

```csharp
EnsureDatabase.For.PostgresqlDatabase(connectionString);   // создаёт БД, если нет
var upgrader = DeployChanges.To
    .PostgresqlDatabase(connectionString)
    .WithScriptsEmbeddedInAssembly(Assembly.GetExecutingAssembly())  // db/migrations/*.sql
    .LogToConsole()
    .Build();
return upgrader.PerformUpgrade();
```

- **Скрипты — embedded ресурсы.** В csproj: `<EmbeddedResource Include="..\migrations\*.sql" …>`.
  Любой новый `V00N__*.sql` попадает в сборку автоматически (пересборка обязательна).
- **Журнал.** DbUp ведёт таблицу `schemaversions` (по умолчанию, схема `public`): каждый успешно
  применённый скрипт записывается по имени. Повторный прогон применяет только новые → идемпотентность.
- **Forward-only.** Уже применённый скрипт повторно не запускается, даже если его отредактировать.
  Отсюда — правило **варианта A**: изменения схемы вводим **новой** миграцией, а не правкой старой
  (иначе рассинхрон между БД, где скрипт уже в журнале, и новой БД).
- **Порядок применения** — по имени ресурса. Именование `V00N__snake_case.sql` с zero-padding
  гарантирует корректную лексикографическую сортировку.
- **Транзакции.** Транзакция-на-скрипт не включена явно. Каждый `V*.sql` должен быть самодостаточным
  и по возможности идемпотентным на уровне DDL (`CREATE … IF NOT EXISTS`, `create_hypertable(… ,
  if_not_exists => TRUE)`).

## Строка подключения (приоритет)

`Program.cs` берёт строку в порядке:

1. `args[0]` — явный аргумент CLI;
2. переменная окружения `SCINVERSE_DB`;
3. дефолт: `Host=localhost;Port=5432;Database=scinverse;Username=scinverse;Password=scinverse`.

Дефолт совпадает с кредами `docker-compose`, поэтому локально мигратор запускается без параметров.

## Конвенции миграций

- Имя файла: `V<NNN>__<краткое_описание>.sql` (например, `V003__derivative_and_risk.sql`).
- Один логический блок изменений на файл; DDL — идемпотентный, где возможно.
- Расширения/hypertable объявлять с `IF NOT EXISTS` / `if_not_exists => TRUE`.
- Цена — в ticks (`price_ticks`); справочные поля не дублировать в фактах (см. `db-design.md`).

## Версии пакетов (Npgsql ↔ dbup)

Связка версий критична и управляется централизованно (`Directory.Packages.props`, CPM с транзитивным
пиннингом):

- Проекты таргетят **net8.0**. Для net8.0 `dbup-postgresql 6.0.3` требует **`Npgsql >= 9.0.2`**
  (у netstandard2.0-таргета — Npgsql 8, но он к нам не относится).
- Транзитивный пиннинг зажимает Npgsql до версии из CPM. Если там `< 9.0.2` — мигратор падает с
  `FileNotFoundException: Npgsql, Version=9.0.2.0`.
- Интеграционные тесты в одном процессе используют и мигратор, и storage → версия Npgsql **едина**
  на всё решение.
- Зафиксировано: **`Npgsql = 9.0.3`**, `dbup-core = 6.0.4`, `dbup-postgresql = 6.0.3`.

## Пиннинг образа

- Тесты используют `timescale/timescaledb:2.17.2-pg16` (`TimescaleFixture`).
- Compose использует `timescale/timescaledb:latest-pg16` → **привести к `2.17.2-pg16`** для паритета
  и воспроизводимости (задача 0.1). Нужен именно образ TimescaleDB (ванильный Postgres не знает
  `CREATE EXTENSION timescaledb` / `create_hypertable`).

## Команды (PowerShell)

```powershell
# 0.2 — поднять БД
docker compose up -d
docker compose ps                      # дождаться healthy

# 0.3 — накатить миграции (дефолтная строка = креды compose)
dotnet run --project db/Scinverse.Db.Migrator
#   либо явно:
# $env:SCINVERSE_DB = "Host=localhost;Port=5432;Database=scinverse;Username=scinverse;Password=scinverse"
# dotnet run --project db/Scinverse.Db.Migrator

# 0.4 — верификация схемы
docker exec -it scinverse-timescaledb psql -U scinverse -d scinverse -c "\dt"
docker exec -it scinverse-timescaledb psql -U scinverse -d scinverse -c "SELECT * FROM schemaversions;"
docker exec -it scinverse-timescaledb psql -U scinverse -d scinverse -c "SELECT hypertable_name FROM timescaledb_information.hypertables;"
```

## Сброс dev-БД (при необходимости повторить с нуля)

```powershell
docker compose down -v      # -v удаляет том scinverse_pgdata (все данные!)
docker compose up -d
```

## Обвязка запуска

Решение: **`docker compose up -d` + `dotnet run`** — индустриальный стандарт, отдельная обвязка не нужна.

- CLI-мигратор (`db/Scinverse.Db.Migrator`) уже существует и является точкой входа.
- Миграции накатываются самим запуском мигратора; дополнительный скрипт не требуется.
- Отдельный сервис `migrator` в `docker-compose.yml` **не заводим**: он потребовал бы Dockerfile и
  сборку образа, не давая выгоды поверх `dotnet run`.

## Риски и заметки

- `EnsureDatabase` создаёт БД, если её нет; в compose БД создаётся init'ом контейнера — конфликтов нет.
- Изменение PK `md_trade` (будущий `source_id`, Фаза 2) на непустой БД нетривиально; на dev делаем
  через `down -v` + повторный накат — отсюда вариант A и отдельная миграция.
