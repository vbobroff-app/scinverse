# Phase 7j — report: расписание соединения

**Статус:** `IN PROGRESS`. **Обновлено:** 2026-07-17.

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
| 7j.5 | Тесты (окно, API, supervisor synthetic) | PARTIAL | unit окна 9✓; integration store — нужен Docker + V021; Host был залочен процессом |

## Лог выполнения

| Дата | Действие | Результат |
|------|----------|-----------|
| 2026-07-17 | Заведена фаза 7j: plan/apply/report | документы |
| 2026-07-17 | V021 + `ConnectionScheduleStore` + API + Supervisor + NotificationHub + UI Auto/popover | код; unit окна зелёные |

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
