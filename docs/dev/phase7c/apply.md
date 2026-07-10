# Phase 7c. Реализация: MOEX ISS API — ссылки и разбор

Справочник по публичному API Мосбиржи (ISS), из которого берём структуру рынков и расписание торгов.
Общие принципы плана — в [plan.md](plan.md).

## Что такое ISS

**ISS** (Informational & Statistical Server) — веб-сервис Мосбиржи, отдающий рыночные данные по HTTP.
Доступ без авторизации (рыночные данные с задержкой 15 мин; **справочники и расписание — актуальные**).
Форматы: JSON / XML / CSV. Базовый URL: `https://iss.moex.com/iss`.

- Официальное описание (PDF): [«Application Programming Interface ISS»](https://www.moex.com/files/4be999zbzp80bx2bgmwayrtyx0)
- Справочник всех запросов: [iss.moex.com/iss/reference](https://iss.moex.com/iss/reference/?lang=ru)
- Описание календарей (PDF): [«Все рынки (ФР, ВР, СР) — calendars»](https://www.moex.com/files/4rkd3yjkghfhqz4h7g8rewetx4)
- Python-обёртка (для примеров): [apimoex docs](https://wlm1ke.github.io/apimoex/build/html/api.html)
- Postman-коллекция: [API MOEX (Postman)](https://www.postman.com/studentspbstu/api-moex/documentation/kfcn8wc/api-moex)

Общие query-параметры: `lang=ru|en`, `iss.only=<table>` (вернуть только нужную таблицу),
`iss.meta=off` (убрать метаданные колонок), `from`/`till`/`date` (фильтры по датам). Формат ответа —
задаётся расширением: `.json` / `.xml` / `.csv`.

## 1. Структура рынков (engines → markets → boards)

Иерархия «торговая система → рынок → режим торгов». Нужна для каталога бирж/бордов (задел ур.1–2).

| Уровень | Endpoint | Назначение |
| ------- | -------- | ---------- |
| Движки | [`/iss/engines.json`](https://iss.moex.com/iss/engines.json) | Список торговых систем (`stock`, `futures`, `currency`, …) |
| Движок | `/iss/engines/{engine}.json` | Описание и время доступности движка |
| Рынки | `/iss/engines/{engine}/markets.json` | Рынки движка (для СР: `engine=futures` → `market=forts`) |
| Борды | `/iss/engines/{engine}/markets/{market}/boards.json` | Режимы торгов рынка |
| Борд | `/iss/engines/{engine}/markets/{market}/boards/{board}.json` | Описание конкретного борда |

Пример (срочный рынок, борды FORTS):
`https://iss.moex.com/iss/engines/futures/markets/forts/boards.json`

## 2. Производственный календарь (неторговые/рабочие дни)

Таблица `off_days` — исключения к офиц. праздникам + рабочие выходные, **по рынкам**.

| Рынок | Endpoint |
| ----- | -------- |
| Все (ФР/ВР/СР) | [`/iss/calendars/`](https://iss.moex.com/iss/calendars/) |
| Срочный (СР) | [`/iss/calendars/futures`](https://iss.moex.com/iss/calendars/futures) |
| Фондовый (ФР) | [`/iss/calendars/stock`](https://iss.moex.com/iss/calendars/stock) |
| Валютный (ВР) | [`/iss/calendars/currency`](https://iss.moex.com/iss/calendars/currency) |

Полезные фильтры:

- Год целиком: `…/calendars/futures?from=2026-01-01&till=2026-12-31&iss.only=off_days`
- Все дни (не только off): `…/calendars?show_all_days=1&iss.only=off_days&from=2026-01-01`

`off_days` даёт праздники и **рабочие выходные** (когда суббота/воскресенье — торговый день).
Комбинируя с обычной неделей, получаем множество торговых дат.

## 3. Внутридневное расписание сессий (session_schedule)

Таблица `session_schedule` — периоды торгов **на текущий торговый день** по рынку/бордам.

| Рынок | Endpoint |
| ----- | -------- |
| Срочный (СР) | [`/iss/calendars/futures/session`](https://iss.moex.com/iss/calendars/futures/session) |
| Фондовый (ФР) | [`/iss/calendars/stock/session/`](https://iss.moex.com/iss/calendars/stock/session/) |
| Валютный (ВР) | [`/iss/calendars/currency/session`](https://iss.moex.com/iss/calendars/currency/session) |

Поля таблицы `session_schedule` (СР):

| Поле | Тип | Смысл |
| ---- | --- | ----- |
| `tradedate` | date | Дата торгов |
| `secid` | string | Код контракта (прочерк «-» = для всех инструментов) |
| `boardid` | string | Идентификатор борда (прочерк «-» = для всех режимов) |
| `type` | string | Тип периода (`morning_session`, `main_session`, `evening_session`, аукционы…) |
| `time_from` | datetime | Начало периода |
| `time_till` | datetime | Конец периода |
| `updatetime` | datetime | Время обновления записи в ИСС (для инвалидации кэша) |

Пример (СР), фрагмент:

```
2026-03-27  -  -  morning_session  09:00:00 → 10:00:00
2026-03-27  -  -  main_session     10:00:00 → 18:50:00
2026-03-27  -  -  evening_session  19:00:00 → 23:50:00
```

Границы дня для оси = `min(time_from)` … `max(time_till)` по периодам сессии (без учёта аукционов,
если не нужны). Справочник типов — таблица `session_schedule.types`.

Доп. поля (СР): `settlement_session` (начало расчётной сессии) и `clearing_session` (начало
клиринговой) — читаем, в UI пока не используем.

Расписание по режимам (все периоды внутри режима): `/iss/calendars/stock/session/` (таблица
`session_schedule`, поля `boardid`, `type`, `time_from`, `time_till`, `updatetime`).

## 3a. Торгуемые инструменты по борду (для страницы «Структура»)

На листе борда (`движок → рынок → борд`) показываем **актуальный список торгуемых инструментов**.
ISS возвращает два блока: `securities` (статика: код, имя, лот, шаг цены, дата экспирации…) и
`marketdata` (динамика с задержкой: last/bid/ask, объёмы). Для справочной страницы достаточно `securities`.

| Уровень | Endpoint | Блоки |
| ------- | -------- | ----- |
| Инструменты борда | `/iss/engines/{engine}/markets/{market}/boards/{board}/securities.json` | `securities`, `marketdata` |
| Один инструмент | `/iss/engines/{engine}/markets/{market}/boards/{board}/securities/{secid}.json` | `securities`, `marketdata` |
| Все инструменты рынка | `/iss/engines/{engine}/markets/{market}/securities.json` | `securities`, `marketdata` |

Примеры:

- Фьючерсы/опционы FORTS:
  `https://iss.moex.com/iss/engines/futures/markets/forts/securities.json?iss.meta=off`
- Акции режима TQBR:
  `https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off`

Только статика (быстрее, без задержанной динамики): добавить `iss.only=securities`. Фильтрация по
конкретным бумагам — `securities=SBER,GAZP`.

Справочник контрактов СР (с датами): `/iss/calendars/futures/securities?from=…&till=…`.

## 3b. Торги в выходные дни (доп. сессия выходного дня)

С **01.03.2025** MOEX проводит торги на фондовом и срочном рынках по выходным (доп. сессия выходного
дня, ДСВД):

- Часы: **09:50–19:00 МСК** (аукцион открытия 09:50–10:00, основная сессия 10:00–19:00). Ценовые
  границы сужены до 3% от последней цены пред. торгового дня.
- Юридически сессия выходного дня — **часть ближайшего рабочего дня** (обычно понедельника), расчёты
  T+1 (во вторник).
- Торгуются **не все** выходные: на 2026 год исключены `03–04` и `10–11` января, `14–15` февраля,
  `07–08` и `21–22` марта, `09–10` мая, `20–21` июня, `01–02` и `15–16` августа, `12–13` сентября,
  `24–25` октября, `05–06` декабря. В офиц. праздники 23.02, 01.05, 12.06, 04.11 — торги идут по
  графику выходного дня.
- Инструментарий выходного дня — ограниченный (наиболее ликвидные акции + ряд поставочных фьючерсов).

Источники: Interfax [1](https://www.interfax.ru/business/1059741),
[2](https://www.interfax.ru/business/1065802); RB.ru
[3](https://rb.ru/news/v-yanvare-2026-go-4-nerabochih-dnya-moskovskaya-birzha-opublikovala-raspisanie-torgov-na-sleduyushij-god/).

**Точный список торговых/неторговых дат — из ISS `off_days`** (`/iss/calendars/futures`,
`/iss/calendars/stock`), а часы дня — из `session_schedule`. До интеграции ISS фронт использует
эвристику (будни 08:50–23:50, выходные 09:50–19:00) и **не схлопывает** выходные (показывает как
отдельные слоты); схлопывание — опциональный UI-фильтр.

## 3c. Изменение регламента срочного рынка (СР/FORTS) с 14.07.2026

По уведомлению биржи (QUIK/QUIK-сообщение, источник — [moex.com/n101980](https://www.moex.com/n101980))
**с 14 июля 2026** на срочном рынке действует новый регламент торгового дня:

| Период | Время (МСК) |
| ------ | ----------- |
| Аукцион открытия | `06:50–07:00` |
| Утренняя торговая сессия | `07:00–10:00` |
| Основная торговая сессия | `10:00–19:00` |
| Вечерняя торговая сессия | `19:00–23:50` |

- Торговый день СР теперь **06:50–23:50** (ранее утренняя стартовала с 08:50).
- В утреннюю сессию доступны сделки **со всеми инструментами, кроме опционов на валютные пары**.

**Следствия для Scinverse:**

- Зашитый `MoexSchedule` (будни `08:50–23:50`) станет неверным для СР с 14.07.2026 — это ещё один
  довод за **дат-зависимое расписание из ISS** (`session_schedule`), см. §3. До интеграции ISS
  нужно либо обновить константы `MoexSchedule` на `06:50–23:50` (с датой вступления), либо тянуть
  часы из ISS.
- Расписание **зависит от даты и рынка** — единый хардкод не подходит; провайдер расписания
  (`IMarketScheduleProvider`, задача 7c.2) должен возвращать часы для конкретной даты.

## 4. Прочие полезные справочники

- Классификатор рынков: `/iss/calendars/stock/static?iss.only=markets_classifier`
- Классификатор бордов: `/iss/calendars/stock/static?iss.only=boards_classifier`
- Торгуемость инструмента на бордах: `/iss/calendars/stock/securities/boards`
- Запреты на торги (события): `/iss/calendars/stock/securities/suspended/details`
- Фьючерсы/опционы (справочник): `/iss/calendars/futures/securities`

## План интеграции (backend)

1. **`IssClient`** (`Scinverse.Ohs.Connectors.Moex` или новый `…Infrastructure.Moex`): typed
   `HttpClient`, `BaseAddress = https://iss.moex.com/iss/`. Методы `GetOffDaysAsync(market, from, till)`,
   `GetSessionScheduleAsync(market)`, `GetBoardsAsync(engine, market)`. Всегда `.json?iss.meta=off`.
2. **Парсер** ISS-таблиц: формат `{ "<table>": { "columns": [...], "data": [[...], ...] } }` →
   `IReadOnlyList<IReadOnlyDictionary<string,object?>>`. Один универсальный маппер таблиц.
3. **`IMarketScheduleProvider`**: `Task<MarketSchedule> GetAsync(DateOnly, MoexMarket)`; реализации:
   - `IssMarketScheduleProvider` — из кэша `trading_calendar`/`market_session`, наполняемого `IssClient`;
   - `HardcodedMarketScheduleProvider` — текущий `MoexSchedule` (фолбэк).
   Композит: ISS → при ошибке/пустоте фолбэк (лог `warn`).
4. **Кэш (`V008`)**: `trading_calendar(market, trade_date, is_trading, open_msk, close_msk, is_weekend,
   is_short, updated_at)` + `market_session(market, trade_date, type, time_from, time_till)`. Обновление
   по `updatetime` из ISS раз в сутки (hosted-таймер) или лениво при промахе.
5. **`/api/sessions`** строит `SessionDto[]` из провайдера: перечисляем последние N торговых дат
   (по календарю) и берём часы дня; ДСВД включаются по `off_days`/наличию сессии, а не по чекбоксу
   (чекбокс станет опциональным фильтром).
6. **`/api/exchanges/*`** (для страницы «Структура») — тонкий прокси/кэш над ISS:
   `GET /api/exchanges/engines`, `…/{engine}/markets`, `…/{engine}/{market}/boards`,
   `…/{engine}/{market}/{board}/securities`. Отдаём нормализованные DTO (не сырой ISS), редкий кэш.

## Замечания

- Времена в ISS — МСК (`Europe/Moscow`, UTC+3, без DST). Храним `timestamptz` в UTC, отдаём фронту ISO
  со смещением `+03:00`.
- Кэшируем агрессивно: расписание/календарь меняются редко; `updatetime` — ключ инвалидации.
- Fallback обязателен: ISS может быть недоступен (сеть/блокировки) — сервис не должен падать.
