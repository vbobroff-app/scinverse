# Архитектура Scinverse — диаграммы и концепт-решения

Документ описывает архитектурные диаграммы Scinverse и зафиксированные проектные решения.
Связанные документы: [`../../concept.md`](../../concept.md) — концептуальные решения,
[`../../ohs.md`](../../ohs.md) — модель данных и хранилище OHS.

Используются **две дополняющие нотации**:

- **DDD Context Map** — стратегический уровень: границы контекстов и типы интеграции.
- **[C4](https://c4model.com/)** — уровни Context → Container → Component, разрабатываются **по каждому bounded context отдельно**.

Обе рисуются на [C4-PlantUML](https://github.com/plantuml-stdlib/C4-PlantUML).

---

## 1. Каталог диаграмм

| Нотация / уровень | Файл | Что показывает | Статус |
| :--- | :--- | :--- | :--- |
| DDD · Context Map | `contextmap.puml` | Bounded contexts + паттерны интеграции | ✅ черновик |
| C4 · 1. System Context | `context.puml` | Scinverse как «чёрный ящик» + внешние акторы/системы | ✅ черновик |
| C4 · 2. Container | `container-data.puml` | Зум в **Data Context**: OHS \| ODS, БД, API Gateway | ✅ черновик |
| C4 · 3. Component | `component-ohs.puml` | Зум в **OHS** (write-path): сервисы и потоки | ✅ черновик |
| C4 · 3. Component | `component-ods.puml` | Зум в **ODS** (read-path): сервисы и потоки | ✅ черновик |

**Порядок разработки:** DDD Context Map фиксирует границы → по каждому контексту спускаемся в C4 (Container → Component). Первым проработан **Data Context** (OHS + ODS).

---

## 2. Описание диаграмм

### 2.1. Context Map (DDD) — `contextmap.puml`

Стратегическая карта: какие домены (bounded contexts) существуют и **как они договариваются**.

- **Data Context** (OHS + ODS) — владелец канонической модели рыночных данных и справочника инструментов; на входе — **ACL**.
- **Presentation Context** (Web) — визуализация и управление.
- **R&D Context** (Research/Analytics, Python) — исследования, бэктест, пост-трейд аналитика.
- **Identity & Access (IAM)** — Generic subdomain, **adopt** (Keycloak/IdentityServer): OIDC/JWT, роли, права.
- Внешние: Брокер, Биржа, Внешние потребители данных.

Паттерны интеграции: вход `Брокер/Биржа → Data` как `U→D | ACL`; `Data → Presentation/R&D/потребители` как `Open Host Service + Published Language → Conformist`; `IAM → …` как `Published Language → Conformist`.

### 2.2. System Context (C4) — `context.puml`

Scinverse как единая система, вокруг — акторы (Quant, Трейдер/Оператор) и внешние системы (Брокер, Биржа, Внешние потребители). CI/CD и стек **намеренно не показаны** (не runtime-контекст). Брокер и Биржа — равноправные (Plaza2 — прямой доступ к бирже по VPN, минуя брокера).

### 2.3. Container — Data Context — `container-data.puml`

Зум в bounded context **Data Context**. Внутри границы:

- **OHS** (C# / .NET 8, Worker) — write-path;
- **TimescaleDB PRIMARY** (PostgreSQL 16 + TimescaleDB) — приёмник записи, continuous aggregates;
- **TimescaleDB Replica** — read-only;
- **ODS** (C# / .NET 8, ASP.NET Core) — read-path.

Снаружи: Брокер/Биржа (ingestion), **API Gateway** (YARP/Nginx — кромка, JWT), **IAM** (Keycloak), Presentation, R&D, Внешние потребители.

### 2.4. Component — OHS — `component-ohs.puml`

Внутреннее устройство write-path:
`Market Connector (IMarketConnector)` → `Transaq Parser · ACL (ITransaqParser)` → `Normalizer` (+ `Instrument Registry`) → ветвление на `Order Book (IOrderBook)` и `Write Batcher` → `History Writer (IHistoryWriter)` → PRIMARY. Параллельно `Live Publisher` (gRPC) отдаёт нормализованный поток в ODS. `Session & Health` управляет коннектором и фиксирует сессии/гэпы.

### 2.5. Component — ODS — `component-ods.puml`

Внутреннее устройство read-path:
`Query/Replay API` → `Series Service (ITimeframeAggregator)` / `Footprint Builder` / `Order Book Reconstructor` → `Read Repository (Npgsql read-only)` → Replica. Live: `Live Ingest Client (gRPC)` ← OHS → `Live Gateway (SignalR/WebSocket)` → клиенты. `Instrument Registry (cache)` конвертирует `ticks ↔ price` на выдаче.

---

## 3. Концепт-решения

### 3.1. Два контура (hot / cold)

- **🔵 Холодный контур** — сбор и хранение истории (Data Context, OHS/ODS). Оптимизирован под пропускную способность и надёжность, **не участвует в торговых решениях**.
- **🔴 Горячий контур** — торговые агенты + OMS (Trading/Execution, вне Data Context). Берут данные из коннектора напрямую, минуя OHS/ODS.

### 3.2. CQRS: разделение записи и чтения

- **OHS пишет только в PRIMARY** (батчами через `COPY`).
- **ODS и читатели работают только с READ-ONLY репликой.**
- Между ними — потоковая репликация (WAL streaming).
- **Live-поток идёт `OHS → ODS`** (gRPC stream), чтобы клиент имел одну точку чтения и данные свежее лага реплики.

### 3.3. Anti-Corruption Layer на входе

Парсер/нормализатор OHS — это **ACL**: переводит чужую модель TRANSAQ/Plaza2 (нестабильный `secid`, XML) в каноническую (`instrument_id`, `price_ticks`). Инструмент идентифицируется парой `(ticker, board)` (где `ticker` — сокращённый код, TRANSAQ `seccode`), а не `secid`.

### 3.4. Цена в шагах (ticks)

Везде цена хранится и передаётся как целое число шагов (`price_ticks`), человекочитаемое значение вычисляется через `min_step`. Принцип заимствован из QScalp (плотность и сжатие); подробности — в `ohs.md`.

### 3.5. Подготовка данных на стороне СУБД

Свечи по таймфреймам и агрегаты строятся **continuous aggregates TimescaleDB на PRIMARY** (фоновая материализация), реплика отдаёт готовое на чтение. Футпринты и стакан ODS реконструирует из `md_trade` и `md_orderbook_diff` + `md_orderbook_snapshot`.

### 3.6. API Gateway ≠ IAM

- **API Gateway** — enforcement point на кромке: валидирует JWT, маршрутизирует к ODS.
- **IAM (Keycloak)** — issuer токенов (OIDC/JWT). Не является прокси трафика.

### 3.7. Клиент — только web

Единый web-клиент (React + WebGL/WebGPU); десктоп — лишь возможный тонкий потребитель того же API. Обоснование и детали — в `concept.md`.

---

## 4. Конвенции

- **Стек технологий — с уровня Container** (`$techn`). На System Context и Context Map стек не указываем.
- **Bounded contexts** живут в `contextmap.puml`; их контейнеры/компоненты — в отдельных C4-файлах (`container-*.puml`, `component-*.puml`).
- Для читаемости под публичным сервером: `LAYOUT_LEFT_RIGHT()`, короткие подписи, спейсинг (`nodesep`/`ranksep`), меньше стрелок на один узел.

---

## 5. Рендер

- Расширение `jebbs.plantuml` в Cursor.
- Режим — **PlantUML server** (в `settings.json`: `plantuml.render = PlantUMLServer`,
  `plantuml.server = https://www.plantuml.com/plantuml`). Локальные Java/Graphviz не нужны, требуется интернет.
- C4-PlantUML подключается через `!include <C4/C4_Context>` (и `C4_Container` / `C4_Component`) из встроенной stdlib.
- Превью: открыть `.puml` → `Alt+D` (PlantUML: Preview Current Diagram).
