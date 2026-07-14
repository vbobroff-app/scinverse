# Phase 7i — report: полуавтомат записи (Auto)

**Статус:** IN PROGRESS (код готов к проверке на живом Finam; миграция V012).

## Сделано

- `V012__recording_schedule.sql` — `instrument_id`, `connection_id`, `auto_enabled`
- `RecordingScheduleStore` + `GET/PUT /api/recording/schedule`
- `RecordingSupervisor` — тик 30 с + nudge; arm/disarm по сессии MOEX (`futures` / ISS)
- Ручной `DELETE /recordings/{id}` → стоп + Auto off + WS `recordingScheduleChanged`
- UI: общий `StatusSwitch`; `RecordingAutoToggle` слева от Старт/Стоп (инструмент + серия)
- Override серии: Стоп одного → запись+Auto off у него, Auto off у соседей
- `V013__market_schedule.sql` — версионная история распорядка по движку (`confidence`/`source`,
  фазы JSONB). Сид FORTS: до ЕТС (assumed, с 01.03.2025) · ЕТС 23.03.2026 (authoritative) ·
  расширение 06:50 c 14.07.2026 (authoritative). Применена, строки проверены.
- `V014__market_schedule_stock.sql` — фондовый рынок (`stock`, с 01.03.2025, authoritative):
  утро 06:50–09:50, основная 09:50–19:00, вечер 19:00–23:50, ДСВД 09:50–19:00. Источник —
  moex.com/torgovye-sessii-na-fondovom-rynke + s1167. Фазы ФР ≠ СР (утро/основная сдвинуты). Применена.
- `V016__market_schedule_scope.sql` — редизайн base под МОДЕЛЬ SCOPE (см. schedule.md): `engine→market`
  (`futures→derivatives`), + `sec_type`/`category`/`instrument` (per-market коды, `category` = как в
  `futures_asset_class`), unique/lookup-индексы по scope с `COALESCE`. Сиды: валютные фьючерсы
  (`derivatives/futures/currency`, `we_*=NULL` — не торгуют в выходные) на все 3 версии регламента. Применена.
- `V017__market_schedule_exception.sql` — второй слой: исключения по дате (`exc_date`, тот же scope,
  `kind ∈ {no_trade,shifted,shortened}`, `open/close/phases`, `confidence`, `resolved`). Создаётся авто
  после сверки с API (pre-flight). Применена (пустая, наполняется рантаймом).
- Reader `market_schedule` → UI: `IMarketScheduleStore` (базовый профиль рынка на дату: market-уровень,
  под-scope NULL, max(effective_from)≤D; фазы из JSONB в каноническом порядке) + `GET /api/exchanges/{market}/schedule?on=`. Вкладка
  «Расписание» в `ExchangeStructure` (Будни/Выходные, пропорциональная лента фаз, подпись
  достоверности/источника). `/api/sessions` из БД + daily-sync + бэкфилл Finam — следующий инкремент.

- **Интеграции (внешние сервисы), MVP** — `V015__external_service.sql` (adapter/transport/secret/
  exp/enabled, секрет в БД — single-user, до Keycloak). Домен `ExternalService` +
  `IExternalServiceStore` (секрет наружу не отдаём — только `HasSecret`), `ExternalServiceStore`
  (Dapper, COALESCE-секрет). Finam-адаптер `IFinamApi`/`FinamApiClient` (typed HttpClient: auth
  `tapi_sk→JWT` с кэшем ~14м + расписание инструмента). Эндпоинты `GET/POST/PUT/DELETE
  /api/integrations`, `POST /{id}/probe` (health-check), `GET /{id}/schedule?symbol=`. UI: раздел
  «Интеграции» в рейле (`NavSectionId=integrations`) — `IntegrationsPanel` (список + `[+]` форма) +
  `IntegrationForm` (сервис/транспорт/секрет/exp, auth-check после создания) + `IntegrationWorkspace`
  (проверка связи + пробный запрос расписания, время МСК). Пока подтверждатель — ручной пробник;
  pre-flight-хук в auto + `market_schedule_exception` — следующий инкремент (см. schedule.md).

## Проверка

1. Прогнать DbUp (V012 … V015).
2. Перезапустить Host + web.
3. Auto on вне сессии → зелёный; в сессии без связи → жёлтый; пишет → голубой.
4. Ручной Стоп снимает Auto; Стоп страйка снимает Auto с серии, не гасит чужую запись.
