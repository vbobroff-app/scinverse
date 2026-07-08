# Phase 4. Особенности реализации и спецификации

Детали локального запуска OHS и потокового демо-коннектора.

## Предзапуск

- TimescaleDB поднята: `docker compose up -d` (контейнер `scinverse-timescaledb`, healthy).
- Миграции накатаны (Stage 0). При чистом томе — прогнать мигратор: `dotnet run --project db/Scinverse.Db.Migrator`.

## Запуск хоста

```powershell
dotnet run --project services/online-history-server/src/Scinverse.Ohs.Host
```

Конфиг — [`appsettings.json`](../../services/online-history-server/src/Scinverse.Ohs.Host/appsettings.json):
`Ohs:UseFakeConnector`, `ConnectionStrings:Timescale`, `Ohs:Instruments`, `Batcher:*`.

### Поток при `UseFakeConnector: true`

`FakeReplayConnector` проигрывает подготовленные фрагменты
([`SampleData.cs`](../../services/online-history-server/src/Scinverse.Ohs.Host/SampleData.cs)):
`<securities>` (само-засев `instrument` через `registry.RegisterAsync` → upsert) и `<alltrades>`
(≈500 сделок/инструмент) → `TradeNormalizer` → `TradeBatcher` → `TimescaleTradeWriter` (COPY BINARY →
`md_trade`). Коннектор **конечный**: после дампа канал завершается, воркер доигрывает остаток и логирует
«Принято сделок: N». Хост остаётся жив (штатно для `BackgroundService`).

## Верификация

```powershell
docker exec scinverse-timescaledb psql -U scinverse -d scinverse -c "SELECT count(*) FROM md_trade;" -c "SELECT instrument_id, ticker, board_id FROM instrument;"
```

## Реальный TRANSAQ-коннектор (задача 4.2)

Исходник уже есть:
[`TransaqConnector.cs`](../../services/online-history-server/src/Scinverse.Ohs.Connectors.Transaq/TransaqConnector.cs)
— P/Invoke к нативному `txmlconnector.dll` (`Initialize` → `SetCallback` → `connect` → `subscribe
alltrades`; сырой XML из колбэка публикуется в `Channel<string>`, дальше — тот же конвейер). От
synthetic-стриминга отказались.

### Фактическая рабочая настройка (dev)

- **DLL (x64):** `x64\txmlconnector64.dll` из дистрибутива Finam переименована в `txmlconnector.dll`
  и положена в `services/online-history-server/src/Scinverse.Ohs.Host/native/`. `.csproj` копирует её
  рядом с exe (`<None Include="native\txmlconnector.dll" Link="txmlconnector.dll" CopyToOutputDirectory>`,
  с `Condition="Exists(...)"`). Файл **не коммитится** (`.gitignore`: `**/native/*.dll`).
- **Конфиг (не версионируется):** `appsettings.Local.json` в корне проекта Host
  (`.gitignore`: `appsettings.Local.json`), подключён в `Program.cs` последним источником:
  ```csharp
  builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);
  ```
  Содержимое: `Ohs:UseFakeConnector=false`, `Transaq:{Host,Port,Login,Password}`. На dev-ПК креды
  живут здесь; для деплоя вынесем в env/секрет-стор.
- **Шлюз:** боевой Finam — `tr1.finam.ru:3900` (SSL). Демо-доступ — свой host/порт от брокера.

### Битность

Битность процесса обязана совпадать с DLL. Процесс .NET 8 по умолчанию **x64**, поэтому берём
**x64** DLL (`txmlconnector64.dll`). При несовпадении — `BadImageFormatException` при загрузке.

### Резолвинг DLL

`TransaqConnector.EnsureResolver` ставит `NativeLibrary.SetDllImportResolver`. `ResolveDllPath`
ищет по `Transaq:DllPath` как есть (рабочий каталог), затем относительно `AppContext.BaseDirectory`
(куда `.csproj` кладёт копию), поэтому DLL из `native/` находится рядом с exe автоматически.

### Особенности протокола TRANSAQ (обнаружено при отладке)

1. **`connect` асинхронный.** `SendCommand(connect)` лишь принимает команду; фактическое соединение
   приходит колбэком `<server_status connected="true">`. `ConnectAsync` ждёт этот сигнал
   (`TaskCompletionSource` + `WaitAsync`, таймаут `Transaq:ConnectTimeoutSeconds`, по умолчанию 30 c);
   `connected="error"` → исключение с текстом ошибки. Только после этого воркер шлёт `subscribe`.
2. **Формат `subscribe`.** Инструмент задаётся дочерними элементами, не атрибутами:
   `<security><board>TQBR</board><seccode>SBER</seccode></security>`. С атрибутами подписка молча
   не матчит инструмент (0 сделок). Источник: `TXmlConnector.pdf`, §3.5.

## Отладка/наблюдаемость (задача 4.3)

- Нативный лог TRANSAQ пишется в `Transaq:LogDir` (по умолчанию `logs/transaq/*.log`):
  `*_ts.log` — транспорт/сессия (время сервера, статусы), `*_xdf.log` — сырой XML-поток
  (полезно проверять, приходят ли реально `<trade>`).
- Верификация живого потока:
  ```powershell
  docker exec scinverse-timescaledb psql -U scinverse -d scinverse -c "SELECT count(*), max(ts) FROM md_trade WHERE ts::date = current_date;"
  ```
- Serilog пишет в консоль (уровни в `appsettings.json`).
