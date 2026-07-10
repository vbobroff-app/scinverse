# Phase 6b. Отчёт о выполнении

Актуальный статус работ по Phase 6b. Обновляется по мере выполнения задач из [plan.md](plan.md).

**Текущий статус:** `DONE` — control-plane реализован и проверён (build/tests + smoke живого хоста).
**Обновлено:** 2026-07-08.

## Статус задач

| #     | Задача                                                            | Статус | Комментарий |
| ----- | ---------------------------------------------------------------- | ------ | ----------- |
| 6b.1  | Хост → `WebApplication` + health + Swagger + CORS                | DONE   | Web SDK, `/healthz`, Swagger в dev, CORS `admin-dev` |
| 6b.2  | `Scinverse.Ohs.Contracts` (DTO + `IOhsApi`)                     | DONE   | обычный интерфейс; Refit убран (см. ниже) |
| 6b.3  | Порт `UnsubscribeTradesAsync` + `SyntheticLiveConnector`         | DONE   | + no-op в Fake, unsubscribe-команда в Transaq |
| 6b.4  | `IConnectorFactory` + `ICredentialStore` + `ConnectorSession`    | DONE   | фабрика по `kind`, in-memory креды, pump на сессию |
| 6b.5  | `ConnectionManager` (connect/disconnect/test/status)             | DONE   | статусы + событие в `/ws` |
| 6b.6  | `RecordingManager` v2 (динамический start/stop)                  | DONE   | + `CoverageTracker` (heartbeat/counters) |
| 6b.7  | `WebSocketBroadcaster` + `/ws`                                    | DONE   | fan-out, DropOldest на клиента |
| 6b.8  | REST-эндпоинты                                                    | DONE   | instruments/sources/coverage/recordings/connections |
| 6b.9  | Coverage read-модель (сегменты + дыры по `GapThreshold`)         | DONE   | `QuerySegmentsAsync` + `QueryGapsAsync` (оконный) |
| 6b.10 | API-тесты через `WebApplicationFactory` + `OhsApiClient`         | DONE   | 3 теста (reference, lifecycle, WS) |
| 6b.11 | Документация (report/apply/plan/code)                            | DONE   | см. ниже |

## Критерии приёмки — чек-лист

- [x] Хост поднимается как ASP.NET Core; `GET /healthz` → 200; Swagger в dev.
- [x] `POST/DELETE /api/recordings` стартует/останавливает запись, сегмент открывается/закрывается.
- [x] `GET /api/coverage?from&to` отдаёт сегменты + вычисленные `gaps`.
- [x] `GET /api/connections` без секретов; connect/test меняют статус + событие в `/ws`.
- [x] `dotnet build` без ошибок; `dotnet test` зелёный (вкл. API-тесты через `OhsApiClient`).

## Результаты проверки

- **Build:** solution 0 ошибок / 0 предупреждений (TreatWarningsAsErrors).
- **Tests:** 20 unit + 8 integration + 3 api = **31 зелёный**. API-тесты поднимают реальный хост
  (`WebApplicationFactory<Program>` + Testcontainers-БД) и бьют рукописным клиентом `OhsApiClient`:
  reference-данные без секретов; полный цикл записи (connect → start → рост `trade_count` →
  stop → закрытый сегмент в coverage); `/ws` присылает `coverageExtended`.
- **Smoke живого хоста:** `dotnet run` → `GET /healthz` = `{"status":"ok"}`,
  `GET /api/connections` = `synthetic-local` (status `disconnected`, без секретов).

## Отклонения от плана (осознанные)

- Учёт покрытия вынесен из `RecordingManager` в отдельный `CoverageTracker` (счётчики + heartbeat),
  чтобы разорвать цикл зависимостей `ConnectionManager ↔ RecordingManager`. `RecordingManager` —
  чистый оркестратор (start/stop), pump-сессия трогает только `CoverageTracker.Track`.
- Swagger — `Swashbuckle.AspNetCore` 6.6.2 (net8-совместимый), т.к. 10.x ориентирован на новые TFM.
- **Refit убран** (2026-07-08). Его source-generator `InterfaceStubGeneratorV2` падает в хосте
  анализаторов Visual Studio 17.14 (`FileNotFoundException: System.Memory 4.0.0.0`), хотя CLI-сборка
  зелёная. `IOhsApi` стал обычным интерфейсом; типизированный клиент написан вручную
  (`OhsApiClient` на `HttpClient` + `System.Net.Http.Json`). Пакеты `Refit`/`Refit.HttpClientFactory`
  удалены из CPM. Контракт и покрытие тестами сохранены.

## Лог выполнения

| Дата | Действие | Результат |
| ---- | -------- | --------- |
| 2026-07-08 | Созданы план и спецификации Phase 6b | Документы готовы |
| 2026-07-08 | Contracts, хост→ASP.NET Core, коннекторы (unsubscribe/synthetic-live/фабрика/креды), сессии/менеджеры, `/ws`, REST, coverage read | Реализовано, build чист |
| 2026-07-08 | API-тесты (WebApplicationFactory) + полный прогон + smoke живого хоста | 31 тест зелёный, хост отвечает |
| 2026-07-08 | Refit убран (падает генератор в VS 17.14) → рукописный `OhsApiClient`; CPM почищен | Build/31 тест зелёные в CLI |

## Следующий шаг

Phase 7 — админ-фронт (React + Vite + TS): список инструментов, Гант покрытия с цветными
колбасками и подсветкой дыр, старт/стоп записи, экран управления подключениями (можно генерить
TS-клиент из OpenAPI хоста).
