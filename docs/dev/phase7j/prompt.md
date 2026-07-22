# Phase 7j — Handoff prompt (передача в новый чат)

Скопируй этот файл как стартовый контекст новому агенту. Он описывает **что уже сделано**,
**как устроено**, **как запускать/тестировать** и **что осталось**.

---

## 0. Что это

**Scinverse / Online History Server (OHS)** — сервис ingest+хранения рыночных данных с web-UI.
**Phase 7j** — расписание автоподключения провайдера (connection schedule): когда держать линк
живым, авто connect/disconnect по окну и торговому календарю.

Статус фазы: **DONE** по ядру (v1 MVP → v2 якорная модель со слоистыми исключениями →
двухшаговый diff-approve → Notification Composer). Остаток — рыночный профиль и `date`-авторинг
на фронте (см. §6).

Главные доки (читать в этом порядке):
- [report.md](report.md) — статус, лог, артефакты (единый источник правды).
- [v2-exceptions.md](v2-exceptions.md) — доменная модель (правила/резолвер/SCD-2/приоритеты).
- [ui-schedule.md](ui-schedule.md) — как UI мыслит base/changes, режимы модалки, DTO/API.
- [notify-composer.md](notify-composer.md) — сведение уведомлений в одно user+system на пачку.
- [market-profile.md](market-profile.md) — план рыночного профиля (PLANNED).
- [todo.md](todo.md) — незакрытые доработки (профиль, пагинация графика по месяцам).

---

## 1. Доменная модель (backend, v2)

Две таблицы (миграция `db/migrations/V024__connection_schedule_rebuild.sql`):

- `connection_schedule_settings` — на соединение: `auto_enabled`, `engine`, `tz`.
- `connection_schedule` — слоистые правила `main` / `dow` / `date`, окно как **`open` + `duration_min`**
  (якорь по дню открытия сессии, овернайт валиден), SCD-2 (`effective_from/to`, `close_reason`
  ∈ `superseded|canceled`).

Резолв «держать ли линк сейчас» (`ConnectionScheduleResolver`, зеркалится на фронте в
`web/src/core/connectionSchedule.ts`):

- приоритет **`date` > `dow` > `main`**; внутри уровня побеждает **свежесть** (`effective_from`);
- `UpsertRule` — SCD-2 + **авто-ретайр вложенных ⊆-масок** (старое правило → `superseded`);
- `CancelRule` — soft-cancel (`canceled`); `main` опционален (можно жить на одних исключениях).

Ключевые файлы:
- `services/online-history-server/src/Scinverse.Ohs.Domain/ConnectionScheduleRule.cs`,
  `ConnectionScheduleResolver.cs`, `IConnectionScheduleStore.cs`
- `…/Scinverse.Ohs.Storage.Timescale/ConnectionScheduleStore.cs`
- `…/Scinverse.Ohs.Host/ConnectionSupervisor.cs` (тик = `LivenessProbeSeconds`, nudge, retry)
- `…/Scinverse.Ohs.Host/OhsEndpoints.cs` (REST + notify-publish + `compose`)
- `…/Scinverse.Ohs.Contracts/Dtos.cs` (`ConnectionSchedule*Dto`, `ScheduleCompose*`)

REST:
- `GET  /api/connections/{id}/schedule` → `ConnectionScheduleStateDto { settings, rules[] }`
- `PUT  …/schedule/rule[?batchId=]` — upsert (SCD-2)
- `PUT  …/schedule/settings` — auto/engine/tz
- `POST …/schedule/rules/{scheduleId}/cancel[?batchId=]` — soft-cancel
- `POST …/schedule/compose` — **Notification Composer** (см. §3)
- `GET  …/schedule/history`, `GET /api/notifications`

---

## 2. Frontend (web, React + RxJS)

Точка входа: полоса **Связь** → кнопка **Расписание** → `ConnectionSchedulePopover`.

- `web/src/ui/components/ConnectionSchedulePopover.tsx` — модалка авторинга. base (`baseDictRef`,
  immutable-снимок) vs changes (`layers`, черновик). **Двухшаговый approve**: `Утвердить` →
  под-вид `confirm` с diff-превью (`WeeklyDayColumns`, цвета kept/added/removed) → `Подтвердить`.
  Guardrail: предупреждение только при **первой реальной** правке `main` (drag/MOEX-shift), «Отмена»
  откатывает. Live-push баннер при серверном изменении во время правки.
- `web/src/core/scheduleLayerDict.ts` — `ScheduleLayerDict { main, exc[], staticExc[] }`,
  `dictFromRules`, `resolveLayerFor{Dow,Date}`, board-slots.
- `web/src/core/OhsStore.ts` — `connectionSchedule$: Map<id, StateDto>`;
  **`applyConnectionScheduleBatch`** (генерит `batchId`, шлёт пачку PUT/cancel, затем `compose`,
  backfill нового `scheduleId` в `set`-items из ответов PUT).
- `web/src/core/api.ts`, `types.ts` — клиент/DTO.
- `packages/notification-center/src/ui/NotificationRow.tsx` — рендерит `data.lines` столбиком.

---

## 3. Notification Composer (важный паттерн)

Одно действие (Очистить/Утвердить = пачка upsert+cancel) → раньше N уведомлений. Теперь:

1. клиент генерит `batchId`; атомарные `rule_set/rule_canceled` при `?batchId=` **не публикуются**;
2. `POST …/schedule/compose { batchId, kind, items[] }` публикует **одно user** (`connection.schedule.
   cleared|recreated|batch_applied`, message = заголовок, детали в `data.lines`) + **одно system**
   (`connection.schedule.batch`), оба с общим `correlationId = batchId`.

`kind`: `cleared` (только cancel, итог пуст) | `recreated` (пишем на пустой base) | `applied`.
`items[].label` — «скоуп + окно», напр. `«Сб, Вс (дни 96) 08:50–20:00»` / `«… выкл»`.
Демо-лента уведомлений — только под `VITE_NC_DEMO=1` (иначе фейки мешают приёмке).

---

## 4. Запуск и окружение

- **Backend Host**: слушает `http://localhost:5080` (`/api`, `/ws`). Пользователь обычно запускает
  **из Visual Studio** — НЕ поднимай свой Host на 5080, если попросили запустить из VS; при
  необходимости освободить порт: найти listener на 5080 и остановить процесс.
- **Frontend**: `pnpm dev --port 5174 --force` в `services/online-history-server/web` (Vite,
  прокси `/api` и `/ws` → 5080). Обычно уже запущен.
- **Миграции**: применены до **V024** включительно. Проверять состояние можно через `GET …/schedule`.
- **Dev-хуки**: `window.__ohsStore` (только dev) — для симуляции live-push из консоли браузера:
  подменить запись в `__ohsStore.connectionSchedule$` при открытой правке → всплывёт баннер.
- Тестовые подключения: `synthetic-local` (id=1), `Finam` (id=3).

---

## 5. Соглашения проекта (ВАЖНО)

- **Shell = PowerShell.** НЕ использовать `&&` (не разделитель!) и bash-heredoc (`$(cat <<EOF)`).
  Команды разделять `;`, коммит-сообщение — во временный файл + `git commit -F "$env:TEMP\msg.txt"`.
- **Lint зелёный обязателен**: `npx tsc --noEmit` (0) и `npx eslint src` (0 **errors**; ~14
  pre-existing `react-refresh` warnings допустимы — не роняют). Бэк: `dotnet build …Host.csproj`.
- **Commit style**: `feat(ohs-7j): …` (см. `git log`). Коммитить **только по явной просьбе** пользователя.
- LF→CRLF warnings от git на Windows — норма, игнорировать.
- Пользователь сам финализирует часть фронтового UI и сам решает, когда пушить.

---

## 6. Что осталось (следующие задачи)

- **7j.15 — Рыночный профиль** ([market-profile.md](market-profile.md)): расхардкодить MOEX-пресеты
  в модалке; профиль календаря/рынка — атрибут `schedule settings` соединения (не поля правила).
  Чеклист: имя поля (`engine` vs `calendarProfile`/`marketRef`), каталог профилей + API пресетов,
  supervisor-календарь из профиля, фронт — пресеты из settings.
- **7j.16 — `date`-авторинг на фронте**: static-исключения (календарь дат уже есть, добить UX) +
  **пагинация графика по месяцам** для диапазонов > ~1 мес (сейчас — одна лента + уплотнение
  подписей; план в [todo.md](todo.md)).

Перед стартом новой задачи: прочитай [report.md](report.md) (актуальный статус) и релевантный
доменный/UI-док, сверься с кодом (файлы в §1–§2).
