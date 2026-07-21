# Phase 7j — report: расписание соединения

**Статус:** `DONE` (v1 MVP + v2 якорная модель / dow-исключения). **Обновлено:** 2026-07-19.

Актуальный статус фазы. Обновляется по мере выполнения задач из [plan.md](plan.md) /
[apply.md](apply.md). Якорная модель + слоистые исключения — [v2-exceptions.md](v2-exceptions.md).

## Статус задач

| # | Задача | Статус | Комментарий |
|---|--------|--------|-------------|
| 7j.0 | Docs: plan / apply / report + индексы roadmap/promt | DONE | |
| 7j.1 | V021 `connection_schedule` + store + GET/PUT/history | DONE (v1) | SCD-2 окно; mode UPDATE in-place — заменено v2 |
| 7j.2 | `ConnectionSupervisor` (тик 15 с, nudge, retry ×5, анти-DDoS) | DONE | connect/disconnect по окну+календарю |
| 7j.3 | Notify sink + WS `notification` + коды lifecycle | DONE | `NotificationHub`, `GET /api/notifications`, фронт-адаптер |
| 7j.4 | UI: Auto + Расписание в полосе Связь; popover окна | DONE | тумблер ProviderCard не трогаем; popover MVP |
| 7j.5 | Тесты (окно, API, supervisor synthetic) | DONE | unit окна ✓; integration store (Testcontainers); живая приёмка supervisor на synthetic ✓ |
| 7j.6 | **v2:** V024 rebuild (якорь open+duration, слоистые правила main/dow/date, SCD-2) | DONE | две таблицы: `_settings` + правила; см. [v2-exceptions.md](v2-exceptions.md) |
| 7j.7 | **v2:** домен `ConnectionScheduleRule/Settings` + `ConnectionScheduleResolver` | DONE | приоритеты date>dow>main, свежесть, овернайт по дню открытия, `off` |
| 7j.8 | **v2:** стор UpsertRule (SCD-2 + авто-ретайр ⊆-масок) / CancelRule / settings | DONE | superseded / canceled |
| 7j.9 | **v2:** супервизор на резолвере (auto_enabled, tradingDay по дню открытия) | DONE | |
| 7j.10 | **v2:** API GET state / PUT rule / PUT settings / POST cancel + notify-коды | DONE | `connection.schedule.rule_set/.rule_superseded/.rule_canceled` |
| 7j.11 | **v2:** фронт — поповер авторинга скоупа, `WeeklyScheduleOverview`, клиентский резолвер | DONE | dow-исключения; `date`-авторинг — перспектива |
| 7j.12 | **v2:** тесты — резолвер unit (9) + стор integration (6) | DONE | unit 131 ✓ / integration 43 ✓ / web 27 ✓ |

## Лог выполнения

| Дата | Действие | Результат |
|------|----------|-----------|
| 2026-07-17 | Заведена фаза 7j: plan/apply/report | документы |
| 2026-07-17 | V021 + `ConnectionScheduleStore` + API + Supervisor + NotificationHub + UI Auto/popover | код; unit окна зелёные |
| 2026-07-18 | 7j.5: интеграционные store-тесты (`ConnectionScheduleStoreTests`) 3/3 на Testcontainers (SCD-2 версия окна, SetMode без версии, ListCurrentScheduled только Auto on) | зелёные |
| 2026-07-18 | Живая приёмка `ConnectionSupervisor` на synthetic (id=1): критерий 1 connect в окне (`connect OK 1`, NC `connection.connected`) + disconnect вне окна (окно 03:00–04:00 → `connection.schedule_disconnect` «вне окна / non-trading»); критерий 2 ручной `/disconnect` → `mode=manual, auto=False`; критерий 3 PUT `{mode:auto}` без окна → **400**; критерий 6 lifecycle в NC | приёмка пройдена; крит. 5 (×5 fail) — только code-path (synthetic всегда connect; реальный Finam ронять нельзя — анти-DDoS) |
| 2026-07-19 | **v2** якорная модель + слоистые исключения: V024 (rebuild → `_settings` + правила main/dow/date, `open+duration`, SCD-2 + `close_reason`), домен + `ConnectionScheduleResolver`, стор (UpsertRule SCD-2 + авто-ретайр ⊆-масок как superseded, CancelRule canceled, settings), супервизор на резолвере, API (GET state / PUT rule / PUT settings / POST cancel), notify-коды `connection.schedule.*`, фронт (поповер авторинга скоупа + `WeeklyScheduleOverview` + клиентский резолвер) | unit 131 ✓ / integration 43 ✓ / web 27 ✓; V024 применена; смоук на synthetic id=1 ✓; детали — [v2-exceptions.md](v2-exceptions.md) |

## Ключевые артефакты

### Backend

- `db/migrations/V021__connection_schedule.sql` (v1, заменено), **`V024__connection_schedule_rebuild.sql`** (v2)
- Домен: **`ConnectionScheduleRule` / `ConnectionScheduleSettings` / `ConnectionScheduleState`**,
  **`ConnectionScheduleResolver`** (+ константы `…Scopes/RuleModes/CloseReasons/Dow`)
- `IConnectionScheduleStore` / `ConnectionScheduleStore` (UpsertRule + авто-ретайр, CancelRule, settings)
- `ConnectionSupervisor` (тик = `LivenessProbeSeconds`; резолвер по живым правилам)
- `NotificationHub` / `INotificationPublisher`
- REST: `GET /schedule` (state), `PUT …/schedule/rule`, `PUT …/schedule/settings`,
  `POST …/schedule/rules/{id}/cancel`, `GET …/schedule/history`, `GET /api/notifications`
- Ручной `POST …/disconnect` → Auto off (`SetAuto(false)`)

### Frontend

- `ConnectionAutoToggle`, `ConnectionSchedulePopover` (авторинг скоупа), **`WeeklyScheduleOverview`**
- `core/connectionSchedule.ts` — клиентский резолвер
- Полоса Связь в `InstrumentPicker`/`ConnectionLane`: Auto + Расписание
- `OhsStore.connectionSchedule$: Map<id, ConnectionScheduleStateDto>`, WS `notification` → `publishServerNotification`

## Итог

Расписание соединения доведено с MVP (одно окно) до **якорной модели со слоистыми исключениями**:
per-connection настройки (`auto/engine/tz`) + правила `main/dow/date` со SCD-2, приоритетами
`date>dow>main`, свежестью внутри уровня, авто-ретайром вложенных масок (`superseded`) и soft-cancel
(`canceled`). Овернайт разрешается по дню открытия сессии. Фронт: авторинг скоупа + read-only
недельный обзор. v1-UI покрывает `main`/`dow`; `date`-авторинг — перспектива v2-фронта. Детали —
[v2-exceptions.md](v2-exceptions.md).

## Что проверить локально

1. Остановить Host, применить миграции (до **V024** включительно), перезапустить Host.
2. Открыть «Расписание»: скоуп `Все` (основное) → окно на ленте → Утвердить; затем `Сб, Вс` →
   своё окно → Утвердить. В недельном обзоре Пн–Пт = основное, Сб/Вс = исключение.
3. Включить Auto → в окне connect, вне окна disconnect (synthetic/Finam).
4. «Снять» правило в обзоре → fallback на нижний уровень; ручной disconnect тумблера → Auto off.
5. Уведомления `connection.*` и `connection.schedule.*` в доке.
