# Phase 6b. Особенности реализации и спецификации

Конкретные решения control-plane OHS. Верхнеуровневый дизайн Stage 1 — в [../apply.md](../apply.md).

## 1. Хост → ASP.NET Core (Minimal API)

`Program.cs`: `Host.CreateApplicationBuilder` → `WebApplication.CreateBuilder(args)`.

- Весь текущий DI сохраняется; `OhsWorker` остаётся `IHostedService`, но **больше не подписывается
  из статического конфига** — только инициализирует реестр, стартует батчер и heartbeat покрытия.
  Старт/стоп записи теперь инициирует API.
- Serilog: `UseSerilogRequestLogging()`. Swagger/OpenAPI (`Swashbuckle`) — только в Development.
- CORS-политика `admin-dev` (origin dev-фронта Vite, напр. `http://localhost:5173`) — для phase 7.
- Kestrel host/port — из конфигурации (`appsettings.Local.json`), дефолт `http://localhost:5080`.
- Health: `GET /healthz` → 200.

Роутинг группируем: `app.MapGroup("/api")` + `MapOhsEndpoints()` (extension-метод в Host).

## 2. Контракт: `Scinverse.Ohs.Contracts`

Новый проект `src/Scinverse.Ohs.Contracts` (net8, без зависимостей на инфраструктуру и без внешних
пакетов).

- **DTO** (record-и, camelCase в JSON): `InstrumentDto`, `SourceDto`,
  `CoverageSegmentDto { instrumentId, sourceId, from, to?, tradeCount, status, gaps: GapDto[] }`,
  `GapDto { from, to }`, `RecordingDto`, `StartRecordingRequest { instrumentId, connectionId }`,
  `ConnectionDto { connectionId, sourceId, name, kind, settings, enabled, status }` (без секретов),
  `UpsertConnectionRequest`, `ConnectionCredentialsRequest { login, password }`.
- **Интерфейс** `IOhsApi` — обычный C#-интерфейс (HTTP-маршрут каждого метода — в XML-doc). Единый
  контракт для сервера, тестов и (позже) внешних потребителей.

> **Refit убран.** Изначально `IOhsApi` нёс Refit-атрибуты и клиент генерировался source-generator'ом,
> но генератор Refit (`InterfaceStubGeneratorV2`) не грузится в хосте анализаторов Visual Studio
> (`FileNotFoundException: System.Memory 4.0.0.0`) даже на последней 17.14 — при том, что CLI-сборка
> (`dotnet build`) проходит. Чтобы не зависеть от IDE-специфики source-генераторов, клиент написан
> вручную: `OhsApiClient : IOhsApi` на `HttpClient` + `System.Net.Http.Json` (в проекте API-тестов).

> Сервер эндпоинты **не** генерирует из `IOhsApi`. Сервер реализует те же маршруты руками в Minimal
> API; согласованность контракта держим тестами (рукописный клиент бьёт по реальному хосту,
> несоответствие пути/DTO падает в тесте).

## 3. Порт коннектора: отписка + фабрика

### 3.1. `IMarketConnector.UnsubscribeTradesAsync`

Добавляем в порт:

```csharp
Task UnsubscribeTradesAsync(IReadOnlyCollection<InstrumentKey> instruments, CancellationToken ct);
```

- `TransaqConnector` — команда `<command id="unsubscribe"><alltrades><security>…</security></alltrades></command>`
  (симметрично `subscribe`; тот же формат `<board>`/`<seccode>`).
- `FakeReplayConnector` — no-op (поток одноразовый).
- Для живых «ползущих» колбасок в dev без TRANSAQ нужен `SyntheticLiveConnector` (стримит сделки во
  времени по таймеру, `SourceCode = "synthetic"`, поддерживает un/subscribe по инструменту).

### 3.2. `IConnectorFactory` + `ICredentialStore`

```csharp
public interface IConnectorFactory
{
    IMarketConnector Create(string kind, JsonDocument settings, ConnectorCredentials? credentials);
}

public interface ICredentialStore   // in-memory, НЕ персистится
{
    void Set(long connectionId, ConnectorCredentials credentials);
    bool TryGet(long connectionId, out ConnectorCredentials credentials);
    void Clear(long connectionId);
}
```

- `kind = "transaq"` → `TransaqConnector` (host/port/dllPath из `settings`, login/password из
  `ICredentialStore`); `kind = "synthetic"` → `SyntheticLiveConnector`.
- Dev-сид кредов: если в `appsettings.Local.json` есть `Transaq:Login/Password`, при старте кладём в
  `ICredentialStore` для подключения с `kind=transaq` (чтобы не вводить руками).

## 4. Сессии и менеджеры

- **`ConnectorSession`** — обёртка над одним живым `IMarketConnector`: держит pump-таск, который
  читает `connector.Messages`, гоняет `parser → normalizer(sourceId) → batcher` и вызывает
  `RecordingManager.Track`. По одной сессии на подключённое `connection_id`.
- **`ConnectionManager`** — реестр сессий по `connectionId`: `ConnectAsync` (фабрика → connect →
  запуск pump), `DisconnectAsync`, `TestAsync` (короткий connect/ping без подписок), `GetStatus`.
  Публикует `connectionStatusChanged` в `WebSocketBroadcaster`.
- **`RecordingManager` v2** — эволюция 6a: `StartAsync(instrumentId, connectionId)` (резолв
  инструмента → open сегмент через `CoverageTracker` → subscribe на коннекторе подключения),
  `StopAsync(instrumentId)` (unsubscribe → close), `List`. Хранит связь recording → connectionId.
  Публикует `recordingStarted/Stopped`.
- **`CoverageTracker`** — учёт покрытия (счётчики + heartbeat + open/close сегмента), вынесен из
  `RecordingManager`, чтобы разорвать цикл зависимостей `ConnectionManager ↔ RecordingManager`
  (pump-сессия трогает только `CoverageTracker.Track`). Публикует `coverageExtended`.

Батчер/писатель — общие (один `md_trade`), `source_id` уже сквозной (phase 5).

## 5. WebSocket `/ws`

- `WebSocketBroadcaster` (singleton): держит set активных сокетов; `Broadcast(LiveEvent)` шлёт JSON
  всем. Fan-out через `Channel` на сокет; медленный клиент дропается, не блокируя остальных.
- Троттлинг `coverageExtended` — не чаще ~1/сек на `(instrument, source)` (коалесинг `tradeCount`/`to`).
- Эндпоинт: `app.MapGet("/ws", …)` + `HttpContext.WebSockets.AcceptWebSocketAsync()`; сервер только
  пушит (входящие сообщения игнорируем/используем как ping).
- События: `recordingStarted`, `recordingStopped`, `coverageExtended`, `connectionStatusChanged`
  (дискриминатор `type`).

## 6. REST-эндпоинты (Minimal API)

| Метод/маршрут | Действие |
| ------------- | -------- |
| `GET /api/instruments` | список инструментов (из `IInstrumentStore`) |
| `GET /api/sources` | `data_source` |
| `GET /api/coverage?from&to` | сегменты + вычисленные `gaps` (см. §7) |
| `GET /api/recordings` | активные записи + статус |
| `POST /api/recordings` | `{instrumentId, connectionId}` → старт |
| `DELETE /api/recordings/{instrumentId}` | стоп |
| `GET /api/connections` | подключения **без секретов** + статус |
| `POST /api/connections`, `PUT /api/connections/{id}` | upsert (через `IConnectionStore`) |
| `PUT /api/connections/{id}/credentials` | положить креды в `ICredentialStore` (write-only) |
| `POST /api/connections/{id}/connect` \| `/disconnect` \| `/test` | управление сессией |

Валидация: `instrumentId`/`connectionId` существуют, `connection.enabled`, есть креды для `transaq`.

## 7. Coverage read-модель (сегменты + дыры)

- Сегменты: `SELECT … FROM coverage_segment WHERE started_at < @to AND (ended_at IS NULL OR ended_at > @from)`.
- Внутрисессионные **дыры** из `md_trade` оконным запросом в границах сегмента:

```sql
SELECT ts AS gap_from,
       lead(ts) OVER (PARTITION BY instrument_id, source_id ORDER BY ts) AS gap_to
FROM md_trade
WHERE instrument_id = @i AND source_id = @s AND ts BETWEEN @from AND @to
-- в приложении оставляем пары, где (gap_to - gap_from) > GapThreshold
```

`GapThreshold` — в `OhsOptions` (напр. 60 сек). На больших окнах ограничиваем масштаб видимым
диапазоном Ганта (параметры `from/to` обязательны). Живёт в `CoverageStore` (read-метод) или
отдельном `CoverageQuery`.

## 8. Тесты

- **`Scinverse.Ohs.ApiTests`** (новый) — `WebApplicationFactory<Program>` поднимает хост с
  тестовой БД (Testcontainers, как в IntegrationTests) и `UseFakeConnector`/synthetic; рукописный
  клиент `OhsApiClient : IOhsApi` бьёт по `TestServer`. Проверяем: instruments/sources, старт записи → сегмент открыт →
  стоп → закрыт, coverage с gaps, connections без секретов, WS присылает `coverageExtended`.
- Для `Program` доступного в тестах — сделать класс `public partial class Program {}` в хосте.
- Unit: `RecordingManager` v2 (start/stop с фейковым коннектором и стором), троттлинг брокастера.

## 9. Порядок реализации

1. 6b.2 Contracts (DTO + `IOhsApi`) — контракт вперёд.
2. 6b.1 хост → `WebApplication` + health + Swagger.
3. 6b.3 порт unsubscribe + `SyntheticLiveConnector`.
4. 6b.4–6b.6 фабрика/креды/сессии/менеджеры + `RecordingManager` v2.
5. 6b.7 брокастер + `/ws`.
6. 6b.8–6b.9 REST + coverage read.
7. 6b.10 API-тесты (рукописный `OhsApiClient`).
8. 6b.11 документация.
