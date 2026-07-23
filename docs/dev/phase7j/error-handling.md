# Phase 7j — Обработка исключений расписания + информирование в NC

Статус: **СПРОЕКТИРОВАНО** (форматы NC согласованы на fake-прототипах), реализация — по плану §7.

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

**Severity:**
- Рутинные плановые действия (правки расписания, Auto on/off) → `info`.
- `ok` резервируем за реальными позитивными переходами состояния (связь установлена, инцидент закрыт).
- Инфра-сбой → `error`; неперехваченное → `critical`.

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
user·info + system·info. Инфра-сбой → **rollback** + user·error + system·error. Ответ
`{ ok, applied[], superseded[] }` либо соответствующий HTTP-код + `{ error }`.

Убирает класс «частичная запись» и клиентский костыль backfill'а id. `compose`-эндпоинт становится
не нужен (логика переезжает в batch).

### B. Глобальный exception-handler (safety-net)

`IExceptionHandler` / `UseExceptionHandler` в `Program.cs`: любое неперехваченное исключение →
ProblemDetails 500 (без стека наружу) + лог Serilog с `requestId` + публикация `ohs.unhandled`
(system·critical, `correlationId=requestId`).

### C. Фронт без оптимизма + мост в NC

- `commit()` **не** делает `hardClose()` вслепую: на сбое попап остаётся открыт с инлайн-баннером,
  черновик сохранён; закрывается только при `ok`.
- `applyConnectionScheduleBatch` — один вызов `POST …/batch`; `ok` → refresh + close; 4xx/5xx →
  баннер (NC-строку опубликовал сервер); обрыв сети → клиентский `notify.error` + refresh.
- Одиночные операции (если останутся) — обёртка `runCommand` вместо `console.error`.

---

## 4. Словарь NC-сообщений (согласованный каталог)

Fake-прототипы всех кейсов — `web/src/core/ncFakeSchedule.ts` (DEV, `window.__ncFake.*`;
удалить после реализации).

### Операция «пачка» (`POST …/schedule/batch`)

| # | Проблема | HTTP | Кто | NC-строки |
|---|----------|------|-----|-----------|
| 1a | Успех (applied) | 200 | сервер | user·info `connection.schedule.batch_applied` + system·info `connection.schedule.batch` |
| 1a | Успех (cleared) | 200 | сервер | user·info `connection.schedule.cleared` + system·info `batch` |
| 1a | Успех (recreated) | 200 | сервер | user·info `connection.schedule.recreated` + system·info `batch` |
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

**Мёртвые пути** для текущего UI (весь авторинг идёт через batch; `upsert/cancelConnectionScheduleRule`
в сторе не вызываются). При реализации — эндпоинты удалить либо оставить с базовой обработкой ошибок
**без отдельного NC-UX**.

### Глобальный safety-net

| # | Проблема | HTTP | Кто | NC-строки |
|---|----------|------|-----|-----------|
| 4 | Неперехваченное исключение | 500 | сервер | system·critical `ohs.unhandled` (`correlationId=requestId`) |

### Тексты (согласовано)

- **1a recreated** — user: `Расписание 3 («Finam»): пересоздано (2)`; lines: `Правило «основное
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

- [ ] **Contracts**: `ScheduleBatchRequest` / `ScheduleBatchResultDto` (`Dtos.cs`).
- [ ] **Store**: `IConnectionScheduleStore.ApplyBatchAsync(...)` + реализация (supersede+insert+cancel
      в одной `tx`), возврат applied/superseded.
- [ ] **Endpoints**: `POST …/schedule/batch` (валидация → 400 без NC; успех → user+system info;
      инфра → rollback + user·error + system·error); удалить `compose`; настройки/пачку логировать в
      scope `batchId`.
- [ ] **Exception handler**: `IExceptionHandler` в `Program.cs` (`ohs.unhandled`, requestId).
- [ ] **API-клиент**: `applyScheduleBatch` (один запрос) в `api.ts`.
- [ ] **OhsStore**: упростить `applyConnectionScheduleBatch` под новый эндпоинт; на ошибке —
      `notify.error`; убрать fail-fast/backfill-костыль.
- [ ] **Попап**: `commit()` не закрывать на сбое (баннер + сохранённый черновик).
- [ ] **Одиночные rule/cancel**: удалить или обернуть обработкой ошибок.
- [ ] **Уборка**: удалить `ncFakeSchedule.ts` и его импорт из `notifications.ts`.
- [ ] Lint/типы зелёные (`tsc --noEmit`, `eslint src`, `dotnet build …Host.csproj`).
