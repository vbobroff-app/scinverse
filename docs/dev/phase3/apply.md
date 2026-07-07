# Фаза 3. Особенности реализации и спецификации

Детали тестового контура. Версии тест-пакетов управляются централизованно
(`Directory.Packages.props`): xunit, FluentAssertions, Testcontainers.PostgreSql, coverlet.

## Тестовые проекты

| Проект | Тип | Что покрывает |
| ------ | --- | ------------- |
| `Scinverse.Ohs.UnitTests` | unit (без БД) | `TickMath` (цена ↔ ticks), `TransaqXmlParser` (парсинг + устойчивость к битым записям), `TradeNormalizer` (нормализация в `TradeRecord`) |
| `Scinverse.Ohs.IntegrationTests` | integration (Testcontainers) | `TimescaleTradeWriter`: COPY-запись сделок, чтение обратно, идемпотентность по PK, NULL open interest, пустой батч |

## Интеграционные тесты (Testcontainers)

`TimescaleFixture` (`IClassFixture`, один контейнер на класс):

1. Поднимает эфемерный `timescale/timescaledb:2.17.2-pg16` (та же версия, что в `docker-compose`).
2. Прогоняет **реальные** миграции через `DatabaseMigrator.Run(...)` — тот же код, что и продовый
   мигратор, то есть тесты валидируют и сами миграции.
3. Сидит один справочный инструмент (`SBER`/`TQBR`) для FK `md_trade → instrument`.
4. Между тестами `TRUNCATE md_trade` (в `InitializeAsync` класса тестов).

Требования: запущенный **Docker** (Testcontainers сам поднимает/гасит контейнер; отдельный
`docker compose up` для тестов не нужен — у них свой изолированный контейнер).

## Команды

```powershell
# 3.1 — сборка
dotnet build services/online-history-server/Ohs.sln -clp:ErrorsOnly

# 3.2 — только unit (быстро, без Docker)
dotnet test services/online-history-server/tests/Scinverse.Ohs.UnitTests

# 3.3 — только integration (нужен Docker)
dotnet test services/online-history-server/tests/Scinverse.Ohs.IntegrationTests

# всё сразу (по solution)
dotnet test services/online-history-server/Ohs.sln
```

## Заметки

- Первый прогон интеграционных тестов может тянуть образ TimescaleDB (если не в кэше Docker) —
  дольше по времени; последующие быстрые.
- Тесты используют Npgsql 9.0.3 (единая версия решения, см. `phase0/apply.md`).
- Идемпотентность записи проверяется на уровне PK `md_trade (instrument_id, trade_no, ts)` —
  повторный батч даёт `0` вставок.
