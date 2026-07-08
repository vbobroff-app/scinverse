# Phase 4. Отчёт о выполнении

Актуальный статус работ по Phase 4. Обновляется по мере выполнения задач из [plan.md](plan.md).

**Текущий статус:** `DONE` — смоук (4.1) и реальный TRANSAQ-ингест (4.2) подтверждены на живом рынке.
**Обновлено:** 2026-07-08.

## Статус задач

| #   | Задача                                                   | Статус | Комментарий |
| --- | -------------------------------------------------------- | ------ | ----------- |
| 4.1 | Смоук: запуск хоста (fake) против живой БД               | DONE   | 500 сделок в `md_trade`, `instrument` само-засеян |
| 4.2 | Подключить реальный TRANSAQ-коннектор                    | DONE   | живые сделки SBER/TQBR пишутся в `md_trade` |
| 4.3 | Отладка/логи темпа ингеста на реальном потоке            | DONE   | найдены и исправлены 2 бага коннектора (см. лог) |

## Результат смоука (4.1)

Прогон `dotnet run` хоста (`UseFakeConnector: true`) против живой compose-БД:
- лог: «Подписка на ленту сделок: 1 инструментов» → «Конвейер остановлен. Принято сделок: 500»;
- `md_trade` = 500 строк; `instrument` = `SBER/TQBR` (само-засеян через `<securities>`), `min_step 0.01`;
- пример: `price_ticks 10002` (= 100.02), `ts 2026-07-01 07:00Z` (= 10:00 +03:00 в UTC — фикс phase3 работает).

Write-path подтверждён end-to-end (parser → normalizer → batcher → COPY → `md_trade`).

## Результат реального ингеста (4.2)

Прогон `dotnet run` хоста против боевого шлюза `tr1.finam.ru:3900` (`UseFakeConnector: false`):
- `connect` → колбэк `server_status connected="true"` → `subscribe` alltrades по `SBER/TQBR`;
- при подключении пришёл `<securities>` → `instrument` вырос до ~22 800 строк (справочник);
- живые сделки SBER/TQBR полетели в `md_trade`: ~1000 строк за ~3 минуты,
  цена ~`295.27 ₽` (`price_ticks 29527 × min_step 0.01`), корректные `quantity`/`side`.

### Найденные и исправленные баги коннектора

1. **`connect` асинхронный.** `ConnectAsync` слал `subscribe` сразу после `SendCommand(connect)`,
   не дождавшись установки соединения → `TRANSAQ 'subscribe' failed: Cannot process this command
   without connection`. Фикс: `ConnectAsync` ждёт колбэк `server_status connected="true"`
   (TaskCompletionSource + `WaitAsync`, таймаут `TransaqConnectorOptions.ConnectTimeoutSeconds`).
2. **Неверный формат `subscribe`.** Инструмент передавался атрибутами
   `<security board="…" seccode="…"/>`; TRANSAQ ожидает дочерние элементы `<board>`/`<seccode>`.
   С атрибутами подписка молча не матчила инструмент → 0 сделок. Подтверждено `TXmlConnector.pdf`
   и референс-реализациями. Фикс: `<security><board>…</board><seccode>…</seccode></security>`.

## Критерии приёмки — чек-лист

- [x] Смоук наполняет `md_trade` (~500/инструмент), `instrument` само-засеян.
- [x] Реальный TRANSAQ-коннектор пишет живые сделки в `md_trade`.
- [x] Логи показывают темп/счётчик; коннектор устойчив к обрывам.
- [x] `dotnet build` без ошибок; тесты зелёные.

## Лог выполнения

| Дата | Действие | Результат |
| ---- | -------- | --------- |
| 2026-07-08 | Создан план Phase 4 (`docs/dev/phase4/**`) | Документы созданы |
| 2026-07-08 | 4.1 смоук `dotnet run` хоста (fake) | 500 сделок в `md_trade`; `instrument` засеян; write-path OK |
| 2026-07-08 | DLL вендорена (`Host/native/txmlconnector.dll`, x64), csproj копирует в output | загрузка native OK |
| 2026-07-08 | Не версионируемый конфиг `appsettings.Local.json` (Host/Port/creds) | подключён в `Program.cs` |
| 2026-07-08 | 4.2 запуск против `tr1.finam.ru:3900` | connect OK, но `subscribe` падал (баг №1) |
| 2026-07-08 | Фикс №1: ожидание `server_status connected="true"` | subscribe проходит |
| 2026-07-08 | Фикс №2: `subscribe` через дочерние `<board>/<seccode>` | живые сделки SBER пошли в `md_trade` |

## Следующий шаг

Фаза закрыта. Дальше по Stage 1 — эволюция хоста в ASP.NET Core (API/WebSocket),
`RecordingManager` (динамические старт/стоп подписок) и admin-frontend (список инструментов + Гант покрытия).
