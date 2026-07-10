# Phase 7c. Отчёт о выполнении

Актуальный статус фазы 7c. Обновляется по мере выполнения задач из [plan.md](plan.md).

**Текущий статус:** `PLANNED`. **Обновлено:** 2026-07-10.

## Статус задач

| #    | Задача | Статус | Комментарий |
| ---- | ------ | ------ | ----------- |
| 7c.1 | ISS-клиент (`off_days`, `session_schedule`, `boards`) | TODO | typed HttpClient к `iss.moex.com/iss` |
| 7c.2 | Модель `TradingCalendar`/`MarketSchedule` + `IMarketScheduleProvider` (+ fallback) | TODO | ISS → фолбэк `MoexSchedule` |
| 7c.3 | Кэш `V008` (`trading_calendar` + `market_session`), суточное обновление | TODO | инвалидация по `updatetime` |
| 7c.4 | `/api/sessions` + `/api/coverage/extent` из календаря (по рынку инструмента) | TODO | праздники/ДСВД/сокращённые дни |
| 7c.5 | Фронт-страница «Биржи → Структура» (движки/рынки/борды/инструменты) | TODO | API `/api/exchanges/*` + read-only UI |
| 7c.6 | Фронт: `moexSession.ts` — убрать клиентскую эвристику часов | TODO | границы берём из `SessionDto` |
| 7c.7 | Тесты (парсинг ISS-фикстур, fallback, кэш) | TODO | + опц. live-smoke под флагом |

## Открытые пункты

- Источник расписания — публичный ISS (`https://iss.moex.com/iss`), без авторизации. Все ссылки и
  разбор таблиц — в [apply.md](apply.md).
- Решить: наполнять `instrument`-каталог из ISS `securities` или оставить ISS только для расписания и
  справочной страницы «Структура» (запись котировок — по-прежнему через TRANSAQ/коннекторы).
- Уточнить рынки: FORTS → `engine=futures`/`market=forts`; акции → `engine=stock`/`market=shares`.

## Лог выполнения

| Дата | Действие | Результат |
| ---- | -------- | --------- |
| 2026-07-10 | Заведена фаза 7c: план/apply/отчёт; собраны ссылки ISS (структура рынков + расписание) | Документы готовы, статус PLANNED |

## Итог

_(будет заполнено по завершении фазы)_
