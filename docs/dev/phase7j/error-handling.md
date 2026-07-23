# Phase 7j — Обработка исключений расписания + информирование в NC

Статус: **РЕАЛИЗОВАНО** (форматы NC согласованы на fake-прототипах и подтверждены в UI). Чеклист — §7.

Связано: [report.md](report.md), [notify-composer.md](notify-composer.md), [ui-schedule.md](ui-schedule.md).

---

## 1. Диагноз (что было)

Сохранение расписания: попап → `OhsStore.applyConnectionScheduleBatch` → `api.ts` → REST
(`OhsEndpoints`) → `ConnectionScheduleStore` (Dapper/Npgsql) → `NotificationHub` (ring-buffer + WS +
persist в БД). Дыры в обработке ошибок:

- **Бэк**: `PUT …/schedule/rule` ловит только `ArgumentException` → 400; инфра-ошибки (Npgsql,
  таймаут) → голый 500, в NC ничего. `POST …/rules/{id}/cancel` и `PUT …/schedule/settings` —
  `try/catch` нет вовсе. Нет глобального exception-middleware. В batch-режиме (`?batchId=`) атомарные
  уведомления глушатся — и про ошибку тоже ничего не публикуется.
- **Фронт**: `applyConnectionScheduleBatch` шлёт N параллельных PUT/cancel через `forkJoin`
  (**fail-fast**): упал один — `compose` не вызовется, часть операций уже закоммичена → **частичная
  запись**, в NC пусто, а `commit()` уже сделал `hardClose()` (попап закрыт как будто успех).
  Одиночные операции — только `console.error`.

Инфраструктура NC для этого готова (severity error/critical, sourceType user/system, correlationId,
persist, WS, гидрация бэклога) — не хватало дисциплины публикации ошибок и снятия оптимизма.

---

## 2. Принципы

**Кто публикует (без дублей):**
- Сервер получил запрос и знает исход (400/404/5xx с телом) → **сервер** публикует NC (персист,
  переживает рестарт, приходит по WS). Клиент только рисует инлайн-баннер и делает refresh.
- Запрос не дошёл / таймаут без ответа → **клиент** публикует локальный `notify.error` + refresh.

**Классификация исходов:**
- Валидация/ввод (`ArgumentException`) → **400**, только **инлайн-баннер** в попапе, **в NC не пишем**
  (не шумим лентой из-за опечаток).
- Не найдено (подключение/правило) → **404**, `severity: warning`, user.
- Инфра (Npgsql/таймаут/БД) → **5xx**, две строки: user·error (что не удалось) + system·error
  (техдеталь для аудита).
- Неперехваченное → глобальный handler → **500** ProblemDetails + `ohs.unhandled` (system·critical).

**Формат сообщений:**
- **user**-строки: `Расписание {id} («{имя}»): …` (id основной — имя может меняться; имя для читаемости).
- **system**-строки: `Расписание {id}: …` (только id — техаудит, лаконично).
- Заголовок короткий; детали — `data.lines[]` (столбик в раскрытии, `<pre>` со скроллом).
- Тавтологию «Расписание {id}:» в каждой строке `lines` НЕ повторяем (id уже в заголовке).
- `items` в `data` — camelCase (`kind/label/scheduleId`).

**Severity (user-строки пачки):**
- Рутинная правка существующего расписания (`applied`) и Auto on/off → `info`.
- Очистка (`cleared`) → `warning`: расписание стало пустым (Auto без окон) — состояние-предупреждение.
- Пересоздание из пустого (`recreated`) → `ok`: позитивный переход, расписание появилось. Симметрия
  с `cleared` (как `connecting·warning → connected·ok`).
- `ok` в остальном резервируем за реальными позитивными переходами (связь установлена, инцидент закрыт).
- Инфра-сбой → `error`; неперехваченное → `critical`.
- system-строка `batch` — всегда `info` (техаудит, не дублирует user-severity).

**Диагностируемость (trace):**
- Полный stack trace → **только серверный лог** (безопасность + размер).
- Якорь поиска — `correlationId` (отображается как `corr:` в мете строки): для пачки/настроек =
  `batchId`; для `ohs.unhandled` = `requestId` (`HttpContext.TraceIdentifier`/`Activity.Id`), тот же
  id в ProblemDetails и Serilog.
- В `data.lines` — краткая суть исключения (тип + message, усечение ≤ ~500 символов + `…`),
  не весь стек.

---

## 3. Архитектура (A + B + C)

### A. Атомарный batch-эндпоинт (Saga, всё-или-ничего)

Замена клиентской оркестрации (N PUT/cancel + отдельный compose) на **один** запрос:

```
POST /api/connections/{id}/schedule/batch
{ batchId, kind, upserts[], cancels[], items[] }
```

Сервер в **одной транзакции**: валидирует все drafts → применяет cancels+upserts (та же логика
SCD-2 supersede) → backfill `scheduleId` в `set`-items делает сам. Успех → commit + публикация
user-строки (severity по `kind`, см. §2) + system·info. Инфра-сбой → **rollback** + user·error +
system·error. Ответ `{ ok, applied[], superseded[] }` либо соответствующий HTTP-код + `{ error }`.

Убирает класс «частичная запись» и клиентский костыль backfill'а id. `compose`-эндпоинт удалён
(логика переехала в batch).

### B. Глобальный exception-handler (safety-net)

`IExceptionHandler` / `UseExceptionHandler` в `Program.cs`: любое неперехваченное исключение →
ProblemDetails 500 (без стека наружу) + лог Serilog с `requestId` + публикация `ohs.unhandled`
(system·critical, `correlationId=requestId`).

### C. Фронт без оптимизма + мост в NC

- `commit()` **не** делает `hardClose()` вслепую: на сбое попап остаётся открыт с инлайн-баннером,
  черновик сохранён; закрывается только при `ok`.
- `applyConnectionScheduleBatch` — один вызов `POST …/batch` + `handlers.onSuccess/onError`; `ok` →
  refresh + `onSuccess` (close); 4xx/5xx → `onError` → баннер (NC-строку опубликовал сервер); обрыв
  сети (`status 0`) → клиентский `notify.error` + refresh + `onError`.
- Одиночные rule/cancel-пути удалены (YAGNI): весь авторинг идёт через batch.

---

## 4. Словарь NC-сообщений (согласованный каталог)

Формат каждого кейса согласовывался на dev-харнессе `web/src/core/ncFakeSchedule.ts`
(`window.__ncFake.*`); после подтверждения в UI харнесс удалён.

### Операция «пачка» (`POST …/schedule/batch`)

| # | Проблема | HTTP | Кто | NC-строки |
|---|----------|------|-----|-----------|
| 1a | Успех (applied) | 200 | сервер | user·**info** `connection.schedule.batch_applied` + system·info `connection.schedule.batch` |
| 1a | Успех (cleared) | 200 | сервер | user·**warning** `connection.schedule.cleared` + system·info `batch` (расписание стало пустым) |
| 1a | Успех (recreated) | 200 | сервер | user·**ok** `connection.schedule.recreated` + system·info `batch` (расписание появилось из пустого) |
| 1b | Валидация (напр. duration>24ч) | 400 | — | **нет NC** — инлайн-баннер в попапе |
| 1c | Инфра/БД, откат | 5xx | сервер | user·error `connection.schedule.batch_failed` + system·error `connection.schedule.storage_error` |
| 1d | Подключение не найдено | 404 | сервер | user·warning `connection.schedule.batch_failed` |
| 1e | Обрыв сети/таймаут | — | клиент | user·error `connection.schedule.batch_failed` (system-строки нет) |
| 1f | Cancel уже закрытого правила | 200 | сервер | no-op, сворачивается в успех |

### Операция «Auto» (`PUT …/schedule/settings`)

| # | Проблема | HTTP | Кто | NC-строки |
|---|----------|------|-----|-----------|
| 2a | Вкл | 200 | сервер | user·info `connection.schedule.auto_enabled` |
| 2a | Выкл | 200 | сервер | user·info `connection.schedule.auto_disabled` |
| 2b | Инфра/БД (откат тумблера в UI) | 5xx | сервер | user·error `connection.schedule.settings_failed` + system·error `connection.schedule.storage_error` |

### Одиночные rule/cancel (3a/3b/3c)

**Удалены** (YAGNI): эндпоинты `PUT …/schedule/rule` и `POST …/schedule/rules/{id}/cancel`, их методы
в `IOhsApi`/`OhsApiClient`, обёртки в `api.ts`/`OhsStore` и хелпер `ScopeLabel`. Весь авторинг идёт
через batch. Store-примитивы `UpsertRuleAsync`/`CancelRuleAsync` сохранены (SCD-2, покрыты
integration-тестами; `ApplyBatchAsync` переиспользует общий `ApplyUpsertAsync`).

### Глобальный safety-net

| # | Проблема | HTTP | Кто | NC-строки |
|---|----------|------|-----|-----------|
| 4 | Неперехваченное исключение | 500 | сервер | system·critical `ohs.unhandled` (`correlationId=requestId`) |

### Тексты (согласовано)

- **1a applied** (`info`) — user: `Расписание 3 («Finam»): изменено (3)`; system: `Расписание 3: batch (3)`.
- **1a cleared** (`warning`) — user: `Расписание 3 («Finam»): сброшено (2)`; system: `Расписание 3: batch (2)`.
- **1a recreated** (`ok`) — user: `Расписание 3 («Finam»): пересоздано (2)`; lines: `Правило «основное
  05:50-00:50» утверждено` / `Правило «Сб, Вс (дни 96) 08:50-20:00» утверждено`. system: `Расписание 3: batch (2)`.
- **1c** — user: `Расписание 3 («Finam»): не удалось сохранить изменения`; lines: `Изменения не
  применены — ошибка хранилища` / `Повторите попытку; при повторной ошибке — обратитесь к
  администратору`. system: `Расписание 3: ошибка хранилища при сохранении пачки`; lines: `<Npgsql…>`
  / `Откат транзакции, состояние не изменено`.
- **1e** — user: `Расписание 3 («Finam»): нет связи с сервером`; lines: `Изменения не подтверждены —
  проверьте состояние после переподключения` / `Повторите попытку`.
- **2a** — `Расписание 3 («Finam»): автоподключение включено` / `… выключено`.
- **2b** — user: `Расписание 3 («Finam»): не удалось изменить автоподключение`; lines: `Настройка не
  сохранена — ошибка хранилища` / `Повторите попытку; при повторной ошибке — обратитесь к
  администратору`. system: `Расписание 3: ошибка хранилища при сохранении настроек`; lines: `<Npgsql…>`
  / `Настройка не записана, состояние не изменено`.
- **4** — `Внутренняя ошибка сервера: необработанное исключение (500)`; lines: `POST
  /api/connections/3/schedule/batch` / `<ExceptionType: message>`; `corr = requestId`.

---

## 5. Валидация duration > 24ч (реализовано)

Частая ошибка «пробивается» мимо капа ленты (обычный drag ≤24ч, но шаблон/shift пишут start/end
напрямую), на сохранении `durationMin` молча режется до 1439. Сделано в `ConnectionSchedulePopover`:
реактивный красный баннер `.durationBanner` при `(endMin − startMin) > MAX_SPAN_MIN` во время правки
+ блок `approve()`. Это конкретизация кейса 1b (валидация → только инлайн-баннер).

---

## 6. Смежное: настройки NC (реализовано)

Галка «Логотип статуса» разбита на две независимые: **Показывать логотип** (иконка) и **Показывать
тип** (метка за иконкой), обе по умолчанию on. Лейблы типа: `OK:` / `INFO:` / `WARNING:` / `ERROR:` /
`FATAL:` (все заглавными; `critical → FATAL:`). Файлы: `packages/notification-center/src/ui/{dockSettings,
NotificationRow,NotificationDock}`.

---

## 7. План реализации (чеклист)

- [x] **Contracts**: `ScheduleBatchRequest` / `ScheduleBatchResultDto` (`Dtos.cs`); удалён `ScheduleComposeRequest`.
- [x] **Store**: `IConnectionScheduleStore.ApplyBatchAsync(...)` + реализация (supersede+insert+cancel
      в одной `tx`), возврат applied/superseded/canceled; `ApplyUpsertAsync` разделяется с `UpsertRuleAsync`.
- [x] **Endpoints**: `POST …/schedule/batch` (валидация → 400 без NC; успех → user+system info;
      инфра → rollback + user·error + system·error; 404 → user·warning); `compose` удалён; сбой пачки
      логируется в Serilog с `batchId`. Настройки: 2a (`auto_enabled`/`auto_disabled`) + 2b (storage_error).
- [x] **Exception handler**: `GlobalExceptionHandler : IExceptionHandler` + `UseExceptionHandler`/
      `AddProblemDetails` в `Program.cs` (`ohs.unhandled`, `correlationId = requestId`).
- [x] **API-клиент**: `applyScheduleBatch` (один запрос) в `api.ts`.
- [x] **OhsStore**: `applyConnectionScheduleBatch` — один POST; `handlers.onSuccess/onError`; при обрыве
      сети (`status 0`) клиентский `notify.error` (1e); убраны `forkJoin`/backfill-костыль.
- [x] **Попап**: `commit()` не закрывает на сбое — баннер `commitError` в confirm, кнопка «Повторить»,
      черновик сохранён; закрытие только при `onSuccess`.
- [x] **Одиночные rule/cancel**: удалены (YAGNI) — эндпоинты `PUT …/rule` и `POST …/rules/{id}/cancel`,
      `IOhsApi`/`OhsApiClient`-методы, `api.ts`/`OhsStore`-обёртки, мок в тесте, хелпер `ScopeLabel`.
      Store-примитивы `UpsertRuleAsync`/`CancelRuleAsync` оставлены (SCD-2, покрыты integration-тестами).
- [x] **Уборка**: `ncFakeSchedule.ts` и его импорт из `notifications.ts` удалены.
- [x] Lint/типы зелёные (`tsc --noEmit`, `eslint src` — 0 ошибок, `dotnet build` solution — 0/0).
