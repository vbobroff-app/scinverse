# Архитектура Scinverse — диаграммы и концепт-решения

Документ описывает **целевую (to-be)** архитектуру Scinverse и зафиксированные проектные решения.
Связанные документы: [`../../concept.md`](../../concept.md), [`../../ohs.md`](../../ohs.md),
реализация сигналов NC в OHS MVP — [`../dev/phase7j/`](../dev/phase7j/).

Используются **две дополняющие нотации**:

- **DDD Context Map** — стратегический уровень: границы контекстов и типы интеграции.
- **[C4](https://c4model.com/)** — Context → Container → Component, **по каждому bounded context**.

Обе рисуются на [C4-PlantUML](https://github.com/plantuml-stdlib/C4-PlantUML).

> **As-is MVP** (этот репозиторий, только dev): монолит `OHS Host` + встроенный ops-web + mock/локальная
> шина NC. На C4 **не моделируем**. Переход к to-be — отдельный front-repo (product), отдельный NC,
> Keycloak, MFE; ODS — когда дойдём до product UI / webGL.

---

## 1. Каталог диаграмм

| Нотация / уровень | Файл | Что показывает | Статус |
| :--- | :--- | :--- | :--- |
| DDD · Context Map | `contextmap.puml` | BC + NC + IAM (Keycloak) + MFE | ✅ to-be |
| C4 · 1. System Context | `context.puml` | Scinverse + Keycloak + акторы | ✅ to-be |
| C4 · 2. Container | `container-data.puml` | Data (OHS\|ODS) + NC + Product/Admin Front + Gateway + IAM | ✅ to-be |
| C4 · 3. Component | `component-ohs.puml` | OHS: write-path + control-plane + NC Publisher + JWT | ✅ to-be |
| C4 · 3. Component | `component-ods.puml` | ODS read-path | ✅ черновик (код ещё не начат) |

**Порядок разработки диаграмм:** Context Map → Container (платформа) → Component OHS → (позже) Component NC / Presentation.

---

## 2. Описание диаграмм

### 2.1. Context Map — `contextmap.puml`

- **Data Context** (OHS + ODS) — канон рыночных данных; ACL на входе от брокера/биржи.
- **Notification Center (NC)** — единый центр уведомлений и инцидентов; **отдельный деплой и failure domain**
  (не живёт на машине data-plane OHS).
- **Presentation** — два shell’а: **Product Front** (графики / dashboard) и **OHS Admin Front** (ops
  write-path). Оба подключают NC как **MFE remote**.
- **Identity & Access (IAM)** — Keycloak (adopt): OIDC/JWT для всех UI и API (OHS, ODS, NC, Gateway).
- **R&D**, внешние потребители — как раньше.

### 2.2. System Context — `context.puml`

Scinverse как система; снаружи брокер, биржа, потребители и **Keycloak**. Оператор входит через OIDC и
работает с данными / ops / уведомлениями внутри Scinverse.

### 2.3. Container — `container-data.puml`

Внутри Data Context: **OHS** (write + control-plane), **PRIMARY / Replica**, **ODS** (read для product UI).

Снаружи:

| Контейнер | Роль |
| :--- | :--- |
| **Product Front** | React + BFE + self DB; читает **ODS**; NC через **MFE** |
| **OHS Admin Front** | Отдельный ops-shell; control-plane **OHS**; NC через **тот же MFE** |
| **Notification Center** | Отдельный сервис ленты/инцидентов |
| **API Gateway** | JWT (JWKS Keycloak) + маршрутизация к OHS / ODS / NC |
| **Keycloak** | Issuer; login shell’ов и проверка токенов на API |

События: **OHS → NC**. Live данных: **OHS → ODS** (gRPC). Product не ходит в Timescale OHS напрямую.

### 2.4. Component — OHS — `component-ohs.puml`

- **Control Plane API** (+ WS) — подключения, запись, расписание, покрытие; **только JWT Keycloak**.
- Write-path: Connector → Parser/ACL → Normalizer → Batcher/Book → Writer → PRIMARY; Live Publisher → ODS.
- **Session & Link Health** + **NC Publisher** — инциденты связи и системные события в NC.
- Admin Front снаружи (свой репо/деплой); на этой диаграмме — потребитель control-plane.

### 2.5. Component — ODS — `component-ods.puml`

Без изменений по смыслу: read-path для **Product Front** (не админка OHS). Код ODS ещё не начат.

---

## 3. Концепт-решения

### 3.1. Два контура (hot / cold)

- **🔵 Холодный контур** — сбор и хранение истории (Data Context, OHS/ODS). Не участвует в торговых решениях.
- **🔴 Горячий контур** — торговые агенты + OMS (вне Data Context).

### 3.2. CQRS: запись и чтение

- OHS пишет только в **PRIMARY**.
- ODS и читатели — только **Replica** (+ live `OHS → ODS`, чтобы обойти лаг реплики).
- **Product Front** читает ODS; **Admin Front** управляет OHS (control-plane).

### 3.3. Anti-Corruption Layer на входе

Парсер/нормализатор OHS — ACL TRANSAQ/Plaza2 → канон `(ticker, board)`, `price_ticks`.

### 3.4. Цена в шагах (ticks)

Хранение и передача цены — `price_ticks`; отображение через `min_step` (см. `ohs.md`).

### 3.5. Подготовка данных на стороне СУБД

Continuous aggregates на PRIMARY; футпринты/стакан ODS собирает из канонических потоков.

### 3.6. API Gateway ≠ IAM

- **Gateway** — enforcement / маршрутизация, валидация JWT.
- **Keycloak** — issuer (OIDC/JWT). Не проксирует бизнес-трафик.

### 3.7. Два front-shell’а + один NC (MFE)

| Shell | Данные | NC |
| :--- | :--- | :--- |
| **Product Front** | ODS (+ BFE/self DB: auth-сессия, user-settings) | MFE remote |
| **OHS Admin Front** | OHS control-plane | тот же MFE remote |

Один NC на платформу; shell’ы не владеют лентой. **Keycloak** — login обоих shell’ов и JWT на OHS/ODS/NC.

### 3.8. OHS: write-path + control-plane (to-be)

OHS — не только worker записи, но и **control-plane** (Minimal API + WS) для админки: коннекторы,
запись, покрытие, расписание. Это **ops-инструмент write-path**, не product UI графиков.

- Секреты коннекторов — не в БД (in-memory / secret store), метаданные — в `connector_connection`.
- События и инциденты уходят в **NC** (не остаются единственным источником правды во вкладке).
- Весь control API — **через Keycloak JWT** (напрямую и/или через Gateway).

### 3.9. Notification Center — отдельный failure domain

NC переживает падение OHS data-plane (OOM/диск на машине записи). Не размещается на том же хосте, что
TRANSAQ/Timescale PRIMARY. Product и Admin подключают NC через **Module Federation**.

### 3.10. Каталог инструментов

Пагинация + иерархия деривативов на чтении (см. прежние решения / `db-design.md`).

### 3.11. Переход с MVP (вне C4)

Дорожная карта в [`docs/dev/plan.md`](../../dev/plan.md): **gate 11→12** перед WebGL (phase 12).

1. Допилить MVP OHS в **этом** репозитории (dev) — к gate OHS должен быть **полностью готов**.
2. **Gate перед phase 12 (WebGL Ганта):** вынести **Admin Front** + **NC** (отдельные деплои/репо),
   **Keycloak** везде, Admin↔NC через **MFE**. Admin Front после выноса ещё дорабатывается
   (UI + WebGL + NC integration); NC — UI / взаимодействие / MFE features.
3. **Phase 12** — WebGL/LOD уже на вынесенном Admin Front (не в монолите).
4. Позже: Product Front (+ BFE + self DB) + **ODS**; тот же NC remote (MFE).
5. Co-located nginx+OHS на проде — для локальной ops-консоли; объективный наблюдатель — NC вне
   data-plane.

---

## 4. Конвенции

- Стек технологий — с уровня Container (`$techn`). На System Context и Context Map стек не указываем.
- Bounded contexts — в `contextmap.puml`; контейнеры/компоненты — в `container-*.puml` / `component-*.puml`.
- Диаграммы описывают **to-be**; отклонение MVP фиксируем текстом в этом файле, не отдельным C4 as-is.

---

## 5. Рендер

- Расширение `jebbs.plantuml` в Cursor.
- **Local-рендер** с актуальным jar (не из комплекта плагина — там 1.2021.00, ломает C4-stdlib):
  - workspace: `.vscode/settings.json` → `plantuml.render=Local`, `plantuml.jar=tools/plantuml/plantuml.jar`
  - установка jar: [`tools/plantuml/README.md`](../../tools/plantuml/README.md)
- C4: `!include <C4/C4_Context>` / `C4_Container` / `C4_Component` (stdlib, нужен PlantUML ≥ 1.2023).
- Нужны Java 11+ и Graphviz (`dot`). Превью: `.puml` → `Alt+D`; после смены jar — Reload Window.
