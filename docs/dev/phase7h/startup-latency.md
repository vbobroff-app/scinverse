# Data-path: 3 минуты до «первых данных» после connect (регистрация справочника)

**Статус:** `DONE` (2026-08-03). **Дата находки:** 2026-07-24 (живой тест Finam id=3).  
**Issue-якорь (7j):** вынесено из connection-lifecycle → этот файл; ссылки —
[phase7j/issue.md](../phase7j/issue.md) (хвост), [phase7j/plan.md](../phase7j/plan.md) **H3**,
[phase7j/incident.md](../phase7j/incident.md) §H3.

**Уровни (договорённость):**
- **Соединение** (scope 7j) — запуск/инциденты/восстановление связи (`link_liveness`, супервизор, NC).
- **Данные** (этот документ, ingestion/`md_trade`) — приём сделок, регистрация инструментов, покрытие.

Эта находка — целиком на уровне **данных**; связь при этом уже `Live`.

---

## 1. Симптом (было)

После успешного connect тумблер связи **~3 минуты висел зелёным** (`waiting`) и лишь затем становился
голубым (`active`). В логе:

```text
11:04:19  Подключение 3 (transaq) установлено за 7318 мс
11:04:43  Старт записи RIU6/SiU6/SRU6/Si80000BG6 (subscribe)
11:07:34  Подключение 3: первые данные через 195 689 мс (3.26 мин) после установки связи
```

Связь жива, сделки физически шли в канал — но статус `active` не наступал, пока не обработается
первая нормализованная сделка.

---

## 2. Корневая причина

При `connect` TRANSAQ сам (без запроса) выгружает **весь справочник инструментов** (`<securities>` /
`sec_info`) — для FORTS это десятки тысяч позиций. Pump читал поток последовательно и на каждом
`SecurityInfo` ждал `RegisterAsync` → **отдельная транзакция в БД на инструмент**, даже если ключ
уже был в прогретом `_cache` (`InitializeAsync` грузит Postgres на старте Host).

`TradeEvent`-ы стояли в FIFO **позади** справочника → ~30–60k × 4–6 мс ≈ **3.2 мин**.

---

## 3. Решение (реализовано)

### 3.1. In-memory кэш + политика свежести

Кэш — `ConcurrentDictionary<InstrumentKey, Instrument>` в singleton `InstrumentRegistry`
(процесс Host). SoT — Postgres; при рестарте Host словарь прогревается `InitializeAsync` →
`LoadAllAsync` (секунды, не минуты). Redis / IndexedDB для этого hot path не нужны:
resolve сделок — серверный, после рестарта SoT уже в памяти.

| Состояние каталога | Hit `Observe(SecurityInfo)` | Miss |
|--------------------|------------------------------|------|
| **Fresh** (после init / idle persist) | no-op, без БД | батч upsert → кэш |
| **Stale** (после invalidate) | обновить поля в памяти + enqueue фоновый persist | то же |

Инвалидация (разрешить persist hit-ов):

- **Auto-on** соединения — не чаще **раза в торговый день (МСК)** (`Invalidate(force: false)` в
  `PUT /api/connections/{id}/schedule/settings`);
- кнопка **«Обновить справочник»** (⚙️ провайдера) —
  `POST /api/instruments/catalog/refresh` (`Invalidate(force: true)`).

Refresh **сам dump не скачивает** — помечает каталог stale; полный словарь TRANSAQ обычно приходит
на connect/reconnect. После фонового persist и **idle ~3 с** writer вызывает `MarkFresh()`.

### 3.2. #2 Батч + #3 развязка пути сделок

| Путь | Поведение |
|------|-----------|
| Hit + fresh | мгновенно, без БД |
| Hit + stale | память сразу; `InstrumentCatalogPersistQueue` → `InstrumentCatalogPersistWriter` → `UpsertBatchAsync` (~500) |
| Miss | miss-буфер → sync `UpsertBatchAsync` по порогу 500 / `FlushPending` перед сделкой в pump |

Pump (`ConnectorSession.PumpAsync`): `Observe` + `TryFlushMissThresholdAsync` на `SecurityInfo`;
перед `TradeEvent` — `FlushPendingAsync`. Hot path сделок не ждёт построчный upsert справочника.

### 3.3. Карта кода / API

| Слой | Путь |
|------|------|
| Реестр | `Scinverse.Ohs.Ingestion/InstrumentRegistry.cs`, `IInstrumentRegistry` |
| Очередь | `InstrumentCatalogPersistQueue.cs` |
| Writer | `Scinverse.Ohs.Host/InstrumentCatalogPersistWriter.cs` (BackgroundService) |
| Store | `InstrumentStore.UpsertBatchAsync` (+ порт `IInstrumentStore`) |
| Pump | `ConnectorSession.PumpAsync` |
| API | `POST /api/instruments/catalog/refresh` → `InstrumentCatalogRefreshResultDto` |
| Auto-on | `OhsEndpoints` schedule/settings → `registry.Invalidate(force: false)` |
| UI | `ProviderCard` → «Обновить справочник»; `OhsStore.refreshInstrumentCatalog` |
| Тесты | `InstrumentRegistryTests` (unit) |

---

## 4. Приёмка (живой Finam id=3, 2026-08-03)

| Метрика | До | После |
|---------|----|--------|
| `первые данные через …` | ~140–214 с (типично ~2.5–3.5 мин) | **~10–16 с** (`9888` / `15588` мс) |
| Handshake TRANSAQ | ~7–14 с (без изменений) | то же |
| Subscribe → первая сделка | утопало в dump+DB | **~2 с** после Auto-старта записи |

Остаток ~10 с после Live — приём/разбор XML dump `<securities>` в pump (без построчного upsert),
не блокирующая запись справочника в БД.

---

## 5. Как проверить

1. Connect на прогретой БД (свежий каталог) → `active`/голубой за секунды, не минуты.
2. В логе: `первые данные через <N> мс` — N порядка **10–20 с** (не 150+).
3. Реконнект без Refresh / без первого Auto-on за день → снова быстро (hit+fresh).
4. Auto-on (первый за день) или «Обновить справочник» + reconnect → dump уходит в фон.
5. Регресс: новые инструменты (miss) появляются в реестре и БД.
6. Unit: `dotnet test …UnitTests --filter InstrumentRegistryTests`.
