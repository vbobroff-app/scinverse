# Phase 7j — report: расписание соединения

**Статус:** `IN PROGRESS`. **Обновлено:** 2026-07-18.

Актуальный статус фазы. Обновляется по мере выполнения задач из [plan.md](plan.md) /
[apply.md](apply.md).

## Статус задач

| # | Задача | Статус | Комментарий |
|---|--------|--------|-------------|
| 7j.0 | Docs: plan / apply / report + индексы roadmap/promt | DONE | |
| 7j.1 | V021 `connection_schedule` + store + GET/PUT/history | DONE | SCD-2 окно; mode UPDATE in-place |
| 7j.2 | `ConnectionSupervisor` (тик 15 с, nudge, retry ×5, анти-DDoS) | DONE | connect/disconnect по окну+календарю |
| 7j.3 | Notify sink + WS `notification` + коды lifecycle | DONE | `NotificationHub`, `GET /api/notifications`, фронт-адаптер |
| 7j.4 | UI: Auto + Расписание в полосе Связь; popover окна | DONE | тумблер ProviderCard не трогаем; popover MVP |
| 7j.5 | Тесты (окно, API, supervisor synthetic) | DONE | unit окна ✓ (в 115); integration store 3/3 (Testcontainers+V021); живая приёмка supervisor на synthetic ✓ (см. лог) |

## Лог выполнения

| Дата | Действие | Результат |
|------|----------|-----------|
| 2026-07-17 | Заведена фаза 7j: plan/apply/report | документы |
| 2026-07-17 | V021 + `ConnectionScheduleStore` + API + Supervisor + NotificationHub + UI Auto/popover | код; unit окна зелёные |
| 2026-07-18 | 7j.5: интеграционные store-тесты (`ConnectionScheduleStoreTests`) 3/3 на Testcontainers (SCD-2 версия окна, SetMode без версии, ListCurrentScheduled только Auto on) | зелёные |
| 2026-07-18 | Живая приёмка `ConnectionSupervisor` на synthetic (id=1): критерий 1 connect в окне (`connect OK 1`, NC `connection.connected`) + disconnect вне окна (окно 03:00–04:00 → `connection.schedule_disconnect` «вне окна / non-trading»); критерий 2 ручной `/disconnect` → `mode=manual, auto=False`; критерий 3 PUT `{mode:auto}` без окна → **400**; критерий 6 lifecycle в NC | приёмка пройдена; крит. 5 (×5 fail) — только code-path (synthetic всегда connect; реальный Finam ронять нельзя — анти-DDoS) |

## Ключевые артефакты

### Backend

- `db/migrations/V021__connection_schedule.sql`
- `IConnectionScheduleStore` / `ConnectionScheduleStore`
- `ConnectionSupervisor` (тик = `LivenessProbeSeconds`)
- `NotificationHub` / `INotificationPublisher`
- REST: `GET/PUT /api/connections/{id}/schedule`, `…/history`, `GET /api/notifications`
- Ручной `POST …/disconnect` → Auto off (`mode=manual`)

### Frontend

- `ConnectionAutoToggle`, `ConnectionSchedulePopover`
- Полоса Связь в `InstrumentPicker`: Auto + Расписание
- `OhsStore.connectionSchedule$`, WS `notification` → `publishServerNotification`

## Итог

_(заполняется по завершении фазы)_

## Что проверить локально

1. Остановить Host в VS / процесс, применить миграции (V021), перезапустить Host.
2. Утвердить окно в popover → включить Auto → в окне должен connect (synthetic/Finam).
3. Ручной disconnect тумблера → Auto off.
4. Уведомления `connection.*` в доке.
