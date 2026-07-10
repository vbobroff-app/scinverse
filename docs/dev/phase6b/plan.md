# Phase 6b. Control-plane: ASP.NET Core + REST + WebSocket — подробный план

**Цель.** Превратить OHS из воркера на статическом конфиге в управляемый сервис записи с
HTTP/WebSocket API: хост → ASP.NET Core, REST (инструменты, источники, покрытие, записи,
подключения), WebSocket для live-обновлений, фабрика коннекторов по `kind` из
`connector_connection` с in-memory-кредами и динамический старт/стоп записи в рантайме.
Фронт (React) — **phase 7**; здесь только сервер + типизированный C#-клиент для тестов.

Зачем сейчас: 6a заложил схему и запись покрытия статически; 6b даёт control-plane, поверх
которого phase 7 строит админку.

## Исходное состояние (предусловия)

- Phase 6a завершена: `coverage_segment`, `connector_connection`, `CoverageStore`,
  `ConnectionStore`, `RecordingManager` (старт по конфигу, heartbeat, close).
- Хост — generic `Host.CreateApplicationBuilder`; коннектор выбирается статически
  (`Ohs:UseFakeConnector`) и является DI-синглтоном.
- `IMarketConnector` умеет `Connect/Subscribe/Disconnect`, но **не** `Unsubscribe`.

## Принятые решения (детали — в apply.md)

- **Веб-стек:** ASP.NET Core Minimal API (`WebApplication`). Контроллеры не заводим.
- **Контракт + клиент:** отдельный проект `Scinverse.Ohs.Contracts` (DTO + интерфейс `IOhsApi`
  с Refit-атрибутами); из него Refit даёт типизированный C#-клиент, который прогоняется в
  интеграционных тестах через `WebApplicationFactory`. Фронт (TS) клиент не использует.
- **Live-транспорт:** сырой WebSocket `/ws` (без SignalR), сервер шлёт throttled-события.
- **Фабрика коннекторов:** `IConnectorFactory.Create(kind, settings, credentials)`; несколько
  живых коннекторов (по одному на подключение), каждый со своим pump-циклом.
- **Секреты:** креды (login/password) — только in-memory (`ICredentialStore`), не персистятся;
  для dev опционально сидируются из `appsettings.Local.json`. API их не возвращает.
- **Объём:** только сервер; UI — phase 7.

## Задачи

| #    | Задача                                                                                     | Тип     |
| ---- | ------------------------------------------------------------------------------------------ | ------- |
| 6b.1 | Хост → `WebApplication` (ASP.NET Core), Serilog request logging, CORS для dev-фронта        | правка  |
| 6b.2 | `Scinverse.Ohs.Contracts`: DTO + `IOhsApi` (Refit-атрибуты)                                 | новое   |
| 6b.3 | `IMarketConnector.UnsubscribeTradesAsync` + реализации (Transaq/Fake); dev synthetic-live   | правка  |
| 6b.4 | `IConnectorFactory` + `ICredentialStore` (in-memory) + `ConnectorSession` (pump на коннектор)| новое  |
| 6b.5 | `ConnectionManager`: connect/disconnect/test/status по `connector_connection`               | новое   |
| 6b.6 | `RecordingManager` v2: динамический start/stop(instrument, connection) в рантайме           | правка  |
| 6b.7 | `WebSocketBroadcaster` (fan-out) + событийная модель (recording/coverage/connection)        | новое   |
| 6b.8 | REST-эндпоинты: instruments, sources, coverage(+gaps), recordings, connections              | новое   |
| 6b.9 | Coverage read-модель: сегменты + внутрисессионные дыры из `md_trade` по `GapThreshold`       | правка  |
| 6b.10| Интеграционные тесты API через `WebApplicationFactory` + Refit-клиент                       | новое   |
| 6b.11| Обновить `report.md`, `apply.md`, `plan`, `code.md`                                         | правка  |

## Результаты (deliverables)

- Хост отвечает по HTTP; `GET /api/*` возвращают данные; `POST/DELETE /api/recordings`
  стартуют/останавливают запись в рантайме; `/api/connections/*` управляют подключениями.
- `/ws` шлёт live-события (coverageExtended → колбаски «ползут»).
- Фабрика коннекторов + in-memory креды; несколько источников одновременно (transaq + synthetic).
- Типизированный контракт (`IOhsApi`) + зелёные интеграционные тесты API.

## Критерии приёмки

1. Хост поднимается как ASP.NET Core; Swagger/OpenAPI в dev; health-роут отвечает.
2. `POST /api/recordings {instrumentId, connectionId}` создаёт открытый сегмент и запускает
   подписку; `DELETE` — останавливает и закрывает сегмент. Проверяется тестом.
3. `GET /api/coverage?from&to` возвращает сегменты и вычисленные `gaps` (по `GapThreshold`).
4. `GET /api/connections` не возвращает секретов; `connect/test` меняют статус, событие уходит в `/ws`.
5. `dotnet build` без ошибок; `dotnet test` зелёный (unit + integration, вкл. API-тесты через Refit).

## Вне объёма фазы (→ дальше)

- React-фронт (phase 7): Гант, старт/стоп, экран подключений.
- CI/CD (phase 8), импорт QScalp `.qsh` (phase 9).
- Аутентификация/авторизация админки (Keycloak) — отдельный трек ODS/публичной части.
- Реальная многоконнекторная отписка TRANSAQ — проверяется при живой интеграции; для fake/synthetic
  тривиально.
