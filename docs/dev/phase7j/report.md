# Phase 7j — report: расписание соединения

**Статус:** `DONE` по ядру (v1 MVP + v2 якорная модель / dow-исключения + двухшаговый diff-approve +
Notification Composer + **атомарный batch (Saga) и обработка исключений**). Остаток: 7j.15/7j.16
(профиль/`date`-авторинг) и 7j.18 (Auto-connect NC & incident hardening). **Обновлено:** 2026-07-23.

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
| 7j.13 | **Notify Composer:** user-summary на clear/approve поверх атомарных `rule_*` | DONE | [notify-composer.md](notify-composer.md); `batchId` глушит атомарные + `POST …/compose`; `kind` cleared\|applied\|recreated; богатые подписи (дни + окно); backfill `scheduleId` в `set` |
| 7j.14 | **UI:** двухшаговый approve с diff-превью, guardrail на правку main, live-push баннер | DONE | `WeeklyDayColumns` diff (kept/added/removed), `ConfirmDialog`, `__ohsStore` dev-хук, демо-лента под `VITE_NC_DEMO` |
| 7j.15 | **Market / calendar profile** на schedule settings (не на rule); UI без хардкода MOEX | PLANNED | см. [market-profile.md](market-profile.md) |
| 7j.16 | **`date`-авторинг на фронте** (static-исключения) + пагинация графика по месяцам | PLANNED | см. [todo.md](todo.md) |
| 7j.17 | **Обработка исключений расписания:** атомарный `POST …/schedule/batch` (Saga) + глобальный `IExceptionHandler` + severity-модель (applied=info / cleared=warning / recreated=ok, 2a/2b) + попап без оптимизма (баннер + Retry); удалены одиночные rule/cancel/compose | DONE | см. [error-handling.md](error-handling.md); коммиты `86bd497`, `e1ed5b7` |
| 7j.18 | **Auto-connect NC & incident hardening:** имя `Подключение {id} («{name}»)` в supervisor/manager (кэш-helper `ResolveLabelAsync`/`ConnLabel`), `connected=ok`, `connecting=warning+underway`, общий `correlationId` авто-серии, имя в `lost`/`recovered`/`reconnecting`/`schedule_disconnect`; **`connection.auto_error`** (system·error + дедуп) на сбой тика супервизора | КОД ГОТОВ · приёмка | см. [auto-connect.md](auto-connect.md); dotnet build solution 0 |

## Лог выполнения

| Дата | Действие | Результат |
|------|----------|-----------|
| 2026-07-17 | Заведена фаза 7j: plan/apply/report | документы |
| 2026-07-17 | V021 + `ConnectionScheduleStore` + API + Supervisor + NotificationHub + UI Auto/popover | код; unit окна зелёные |
| 2026-07-18 | 7j.5: интеграционные store-тесты (`ConnectionScheduleStoreTests`) 3/3 на Testcontainers (SCD-2 версия окна, SetMode без версии, ListCurrentScheduled только Auto on) | зелёные |
| 2026-07-18 | Живая приёмка `ConnectionSupervisor` на synthetic (id=1): критерий 1 connect в окне (`connect OK 1`, NC `connection.connected`) + disconnect вне окна (окно 03:00–04:00 → `connection.schedule_disconnect` «вне окна / non-trading»); критерий 2 ручной `/disconnect` → `mode=manual, auto=False`; критерий 3 PUT `{mode:auto}` без окна → **400**; критерий 6 lifecycle в NC | приёмка пройдена; крит. 5 (×5 fail) — только code-path (synthetic всегда connect; реальный Finam ронять нельзя — анти-DDoS) |
| 2026-07-19 | **v2** якорная модель + слоистые исключения: V024 (rebuild → `_settings` + правила main/dow/date, `open+duration`, SCD-2 + `close_reason`), домен + `ConnectionScheduleResolver`, стор (UpsertRule SCD-2 + авто-ретайр ⊆-масок как superseded, CancelRule canceled, settings), супервизор на резолвере, API (GET state / PUT rule / PUT settings / POST cancel), notify-коды `connection.schedule.*`, фронт (поповер авторинга скоупа + `WeeklyScheduleOverview` + клиентский резолвер) | unit 131 ✓ / integration 43 ✓ / web 27 ✓; V024 применена; смоук на synthetic id=1 ✓; детали — [v2-exceptions.md](v2-exceptions.md) |
| 2026-07-23 | **7j.18 — auto-connect NC & incident hardening (код).** Рантайм-NC подтянут к эталону ручного connect: `ConnectionManager.ResolveLabelAsync`/`ConnLabel` (кэш имени) → имя `Подключение {id} («{name}»)` во всех строках; `ConnectionSupervisor` — `connecting=warning+underway`, `connected=ok+resolved`, общий `correlationId=connection:{id}:auto:{uid}` на авто-серию (снимается при успехе/исчерпании/сбросе), `schedule_disconnect` с именем; `ConnectionManager` — имя в `lost`(error,Open)/`recovered`(ok,Resolve); `reconnecting`(warning,Progress) с именем. **Плюс `connection.auto_error`** (system·error): сбой тика супервизора по подключению (плановый disconnect, чтение расписания, резолвер — кроме connect-фейлов) больше не молчит в логе, летит в NC с именем и дедупом по сигнатуре (не спамит каждые 15 c). Живая приёмка (окно/обрыв/ретраи на Finam) — за пользователем | dotnet build solution 0 warn / 0 err; см. [auto-connect.md](auto-connect.md) |
| 2026-07-23 | **7j.17 — обработка исключений расписания.** Клиентская оркестрация (N PUT/cancel + `compose`) заменена атомарным `POST …/schedule/batch` (Saga: `ApplyBatchAsync` — всё в одной tx, откат при любом сбое). NC-дисциплина: успех → user (severity по kind: applied=info/cleared=warning/recreated=ok) + system·info batch; валидация → 400 без NC (инлайн-баннер); инфра → user·error+system·error (общий corr); 404 → user·warning; обрыв сети → клиентский user·error. Auto on/off → `auto_enabled`/`auto_disabled` (2a) + `settings_failed` (2b). Глобальный `GlobalExceptionHandler` → `ohs.unhandled` (system·critical, corr=requestId) + ProblemDetails 500. Попап без оптимизма (баннер+Retry). Удалены одиночные rule/cancel (эндпоинты, `IOhsApi`/клиент, обёртки, `ScopeLabel`) и `compose`; убран dev-харнесс `ncFakeSchedule`. Живая приёмка на Finam id=3 ✓ | tsc 0 / eslint 0 err / web 27 ✓ / dotnet build solution 0; коммиты `86bd497`, `e1ed5b7`; см. [error-handling.md](error-handling.md) |
| 2026-07-22 | **UI-полировка + Notification Composer.** Двухшаговый approve с diff-превью (`WeeklyDayColumns`: kept/added/removed; последняя-строка вместо истории; comment в edit); guardrail #3 — предупреждение только при **первой реальной** правке main (drag/MOEX-shift), с откатом по «Отмена»; live-push баннер при серверном изменении во время правки (детект по сигнатуре правил); `__ohsStore` dev-хук для симуляции live-push; демо-лента под флагом `VITE_NC_DEMO`. **Composer**: `batchId` глушит атомарные `rule_set/canceled`, `POST …/compose` → одно user + одно system с общим `correlationId`; `kind` cleared\|applied\|recreated (recreated = запись на пустое расписание); богатые подписи «Сб, Вс (дни 96) 08:50–20:00»; backfill нового `scheduleId` в `set`-items из ответов PUT. Живая приёмка на Finam id=3: очистить/пересоздать/изменить ✓ | tsc 0 / eslint 0 err; dotnet build 0; коммиты `16dca5d`, `c4d4e61` |

## Ключевые артефакты

### Backend

- `db/migrations/V021__connection_schedule.sql` (v1, заменено), **`V024__connection_schedule_rebuild.sql`** (v2)
- Домен: **`ConnectionScheduleRule` / `ConnectionScheduleSettings` / `ConnectionScheduleState`**,
  **`ConnectionScheduleResolver`** (+ константы `…Scopes/RuleModes/CloseReasons/Dow`)
- `IConnectionScheduleStore` / `ConnectionScheduleStore` (UpsertRule + авто-ретайр, CancelRule, settings)
- `ConnectionSupervisor` (тик = `LivenessProbeSeconds`; резолвер по живым правилам)
- `NotificationHub` / `INotificationPublisher`; **`GlobalExceptionHandler : IExceptionHandler`** (safety-net → `ohs.unhandled`)
- REST: `GET /schedule` (state), **`POST …/schedule/batch`** (атомарная пачка, Saga — заменил
  одиночные `rule`/`cancel` и `compose`), `PUT …/schedule/settings`, `GET …/schedule/history`,
  `GET /api/notifications`
- Store: `ApplyBatchAsync` (supersede+insert+cancel в одной tx); `UpsertRuleAsync`/`CancelRuleAsync` —
  SCD-2-примитивы под integration-тесты (переиспользуют `ApplyUpsertAsync`)
- Ручной `POST …/disconnect` → Auto off (`SetAuto(false)`)

### Frontend

- `ConnectionAutoToggle`, `ConnectionSchedulePopover` (авторинг скоупа + **двухшаговый approve с diff-превью**, guardrail на правку main, live-push баннер)
- `WeeklyDayColumns` (столбчатый недельный график, режим diff: kept/added/removed), `ConfirmDialog` (in-modal msgbox: severity, чекбокс, onCancel)
- `core/connectionSchedule.ts` — клиентский резолвер; `core/scheduleLayerDict.ts` — `ScheduleLayerDict` (base/changes)
- Полоса Связь в `InstrumentPicker`/`ConnectionLane`: Auto + Расписание
- `OhsStore.connectionSchedule$: Map<id, ConnectionScheduleStateDto>`; `applyConnectionScheduleBatch` (**один** `POST …/schedule/batch` + `handlers.onSuccess/onError`; при обрыве сети — клиентский `notify.error`); WS `notification` → `publishServerNotification`
- Попап `commit()` — без оптимистичного закрытия: на сбое остаётся с баннером `commitError` + кнопкой «Повторить», закрывается только при успехе
- `NotificationRow` рендерит `data.lines` столбиком; демо-лента под `VITE_NC_DEMO=1`; `window.__ohsStore` (dev) для симуляции live-push

## Итог

Расписание соединения доведено с MVP (одно окно) до **якорной модели со слоистыми исключениями**:
per-connection настройки (`auto/engine/tz`) + правила `main/dow/date` со SCD-2, приоритетами
`date>dow>main`, свежестью внутри уровня, авто-ретайром вложенных масок (`superseded`) и soft-cancel
(`canceled`). Овернайт разрешается по дню открытия сессии. Фронт: авторинг скоупа с **двухшаговым
approve** (diff-превью kept/added/removed), guardrail на правку основного слоя и live-push баннер.
Уведомления сведены **Notification Composer**-ом (одно user + одно system на пачку, общий
`correlationId`, богатые подписи с окном). `main`/`dow` покрыты UI полностью; `date`-авторинг и
рыночный профиль — перспектива (7j.15–7j.16). Детали — [v2-exceptions.md](v2-exceptions.md),
[notify-composer.md](notify-composer.md).

## Что проверить локально

1. Остановить Host, применить миграции (до **V024** включительно), перезапустить Host.
2. Открыть «Расписание»: скоуп `Все` (основное) → окно на ленте → Утвердить; затем `Сб, Вс` →
   своё окно → Утвердить. В недельном обзоре Пн–Пт = основное, Сб/Вс = исключение.
3. Включить Auto → в окне connect, вне окна disconnect (synthetic/Finam).
4. «Снять» правило в обзоре → fallback на нижний уровень; ручной disconnect тумблера → Auto off.
5. Уведомления `connection.*` и `connection.schedule.*` в доке.
