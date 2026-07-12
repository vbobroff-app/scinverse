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

> **Статус реализации (7c.5): DONE.** Backend-прокси над ISS уже есть:
> `GET /api/exchanges/engines`, `/{engine}/markets`, `/{engine}/{market}/boards`,
> `/{engine}/{market}/{board}/securities`. Клиент — `IssExchangeCatalog` (typed `HttpClient`,
> базовый URL `Ohs:IssBaseUrl`) + `IMemoryCache` (структура 6ч, инструменты 30мин). Парсер
> ISS-таблиц (`columns`+`data`) — `Scinverse.Ohs.Domain.Moex.IssTable` (юнит-тесты
> `IssTableTests`). Фронт — раздел «Биржи → Структура» (`web/src/ui/pages/ExchangeStructure.tsx`
> + `core/ExchangeCatalogStore.ts`): ленивое дерево движки→рынки→борды + таблица инструментов
> борда. Поля берём из блока `securities`: `SECID`, `SHORTNAME`, `SECNAME`, `MINSTEP`, `LOTSIZE`,
> `DECIMALS`. У FORTS `LOTSIZE` отсутствует (фьючерс = 1 контракт) → колонка «Лот» пустая; для
> фондовых бордов (`TQBR`) присутствует. **TODO (7c.3):** заменить in-memory TTL на персистентный
> кэш в БД с инвалидацией по `updatetime`.

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

## 3d. Новости и события биржи (лента)

Новости приходят двумя путями — **push от коннектора** (реальное время) и **pull от биржи** (ISS).
Регуляторное уведомление из §3c (смена регламента FORTS, `moex.com/n101980`) — пример такой ленты.

**Pull — официальная лента MOEX (ISS, без авторизации, JSON/XML):**

| Endpoint | Что | Поля/примечания |
| -------- | --- | --------------- |
| [`/iss/sitenews.json`](https://iss.moex.com/iss/sitenews.json) | Новости сайта MOEX | `id, tag, title, published_at, modified_at`; пагинация по 50 (`?start=0`, cursor `INDEX/TOTAL/PAGESIZE`) |
| `/iss/sitenews/{news_id}` | Тело новости | Полный текст по id |
| [`/iss/events.json`](https://iss.moex.com/iss/events.json) | События/активность биржи | Список; деталь — `/iss/events/{event_id}` |

**Push — новостной канал коннектора (реальное время):**

- **TRANSAQ (Finam):** сервер шлёт заголовки `<news_header>` (id, источник, время, тема); тело —
  командой `get_news_body id=...` → `<news_body>`. Плюс серверные `<messages>`.
- **QUIK:** таблица «Новости» / окно сообщений (см. скрин уведомления FORTS).
- **Plaza2/CGate:** системные сообщения торговой системы.

**План (в рамках/после 7c):**

- Поллер ISS `sitenews`/`events` (раз в N минут) — авторитетный источник расписаний/регламентов/статусов;
  хранение как `NewsEvent` (id, tag, title, body, published_at, source=`moex-iss`).
- Новостной канал коннектора (TRANSAQ `news_header`/`news_body`) → нормализация в тот же `NewsEvent`
  (source=`transaq`), лента в UI. Холодный контур, не в hot-path. Оформить отдельным инкрементом.

## 3e. Статус инструмента в карточке (двухслойный) — 7c.9

Цель: в строке инструмента показать авторитетный статус торгов, а не только косвенный «капают ли
сделки». Решает субботний кейс (доступ к бирже есть, но борд вне ДСВД → инструмент «Закрыто»).

**Слой A — расписание борда (авторитетно, для всех инструментов, не lagging).**

- Источник — `session_schedule` (см. §3), уже кэшируется в `market_session` (7c.3). Для инструмента
  берём его `boardid` → периоды текущего торгового дня.
- Статус на момент «сейчас» (МСК):
  - `Пре-опен` — текущее время внутри аукционного периода (`type ∈ {*_auction, opening_auction}`);
  - `Открыто` — внутри торгового периода (`morning/main/evening_session`);
  - `Закрыто` — вне всех периодов дня, либо у борда сегодня нет сессии (нет строк расписания — напр.
    борд без ДСВД в выходной).
- Не зависит от потока данных: работает и для инструментов без записи. Значение стабильно (не мигает),
  меняется только на границах периодов.
- API: расширить существующий источник расписания — либо добавить `boardStatus` в
  `GET /api/instruments` (по борду инструмента на текущий момент), либо отдельный
  `GET /api/boards/status`, который фронт кэширует и мапит по `boardId`. Предпочтительно второй вариант
  (один запрос на N бордов, а не на каждый инструмент), инвалидация по границам периодов.

**Слой B — активность записи (только для записываемых, дополнение поверх A).**

- Источник — `coverageExtended.to` (время последней сделки), данные уже приходят на фронт.
- Порог **адаптивный ~30с** (не 5с как у подключения): ликвидные торгуются постоянно, неликвидные —
  редкими сделками даже при открытом борде, поэтому короткий порог даёт ложный `waiting`.
  - `active` — последняя сделка ≤ 30с назад;
  - после 30с тишины — **не** бинарный `waiting`, а info-подпись «последняя сделка N сек/мин назад»
    (относительное время, тикает на клиенте). Это снимает ложную тревогу для неликвида.
- Слой B рисуется только когда борд по слою A `Открыто`/`Пре-опен` (при `Закрыто` тишина — норма,
  активность не показываем).

**Приоритет и отличие от `instrument.active`.** Слой A задаёт основной статус (борд). Слой B —
уточнение поверх, только для записываемых. Статичный `instrument.active` (справочный «торгуемый в
принципе», из каталога) — отдельный атрибут, со статусом борда не смешивать.

## 3f. Категоризация деривативов (группа контрактов) — справочник `futures_asset_class`

> **Статус: реализовано (7c.10).** Миграция `V011__futures_asset_class.sql`; домен
> `IFuturesAssetClassStore` + `FuturesAssetTaxonomy` (сид-карта s205 + маппинг ISS-`group`);
> `FuturesAssetClassStore` (upsert без перезаписи `confirmed`); `FuturesAssetClassifier` +
> эндпоинты `GET /api/exchanges/asset-classes` и `POST /api/exchanges/asset-classes/refresh`.
> Фронт: плашки-фильтры категорий + колонка «Категория» в таблице инструментов и кнопка
> **«Актуализировать из ISS»**. **Актуализация — по кнопке** (без hosted-таймера).

На сайте MOEX фьючерсы сгруппированы «на акции / на валюту / на индексы / …». Это **не поле ISS**,
а **класс базового актива**. Задача — воспроизвести категоризацию, наполняя справочник **из ISS** и
поддерживая его актуальность (далее категория питает динамические фильтры, как в phase 7d).

### Правильная таксономия (первоисточник — спецификация кодов MOEX, [moex.com/s205](https://www.moex.com/s205))

Категория = «Группа контрактов» по коду базового актива (поле «C» кода контракта / `ASSETCODE` на СР):

| Группа контрактов (MOEX) | Категория (UI) | Код | Примеры `ASSETCODE` |
| ------------------------ | -------------- | --- | ------------------- |
| Индексные контракты | Индексы | `index` | `MIX`/`IMOEX`, `RTS`, `MXI`, `MOEXCNY`, отраслевые (`OGI`,`MMI`,`FNI`), крипто-индексы (`BTC`,`ETH`,`SOL`) |
| Фондовые контракты | Акции | `shares` | `SBER`,`GAZP`,`AFLT`,`ALRS` (+ депозитарные расписки) |
| Валютные контракты | Валюта | `currency` | `Si` (USD/RUB), `Eu` (EUR/RUB), `CNY`, `AED` |
| Процентные контракты | Процентные ставки | `rate` | `RUON` (RUONIA), `MOEXREPO` |
| Товарные контракты | Товары | `commodity` | `BR` (нефть Брент), `GL` (золото), `SILV`, `NG`, агро (`COCOA`,…) |

**Ортогональные атрибуты** (это НЕ категория — отдельные фильтры):

- способ исполнения: расчётный / поставочный;
- срок: месячный / квартальный / **вечный** (perpetual, `IMOEXF`, `CNYRUBF`, `RGBIF`, …);
- «мини»-контракты (`MXI`, `RTSM`).

### Что даёт ISS и как выводить категорию

- В ответе борда (`…/boards/{board}/securities`) на контракт есть **`ASSETCODE`** (код базового
  актива), `SECTYPE`, `LASTTRADEDATE`. **`group` у всех фьючерсов = `futures_forts`** (бесполезен).
- **Авторитетный источник категории — поле `GROUPTYPE` («Группа контрактов») из описания контракта**
  `GET /iss/securities/{SECID}.json?iss.only=description`: MOEX сам отдаёт `Акции`/`Валюта`/`Индексы`/
  `Товары`/`Процентные ставки`. Пример (`SRU6` = `SBRF-9.26`): `ASSETCODE=SBRF`, `GROUPTYPE=Акции`,
  `CONTRACTNAME=Фьючерсный контракт на обыкновенные акции ПАО Сбербанк`.
- ⚠️ **Нельзя** резолвить акции через `/iss/securities?q=<ASSETCODE>`: код фьючерса ≠ тикер акции
  (у Сбербанка фьючерс `SBRF`, акция `SBER`) — выдача `q=SBRF` даёт облигации/опционы, не акцию.
- Классификация: сид-карта `s205` (валюта/ставки/товары/крипто-индексы — офлайн, с именами) →
  для остальных (в осн. акции/индексы) читаем `GROUPTYPE` представителя-контракта → иначе `other`.

### Модель справочника (курируемый + авто-наполняемый)

```sql
-- эскиз (миграция VNNN); имя финализировать при реализации
CREATE TABLE futures_asset_class (
    asset_code   TEXT PRIMARY KEY,           -- ASSETCODE из ISS: Si, SBER, BR, IMOEX…
    category     TEXT NOT NULL,              -- index|shares|currency|rate|commodity
    subcategory  TEXT,                       -- напр. oil|metals|agro для товаров
    title        TEXT,                       -- «курс доллар США – рубль»
    source       TEXT NOT NULL,              -- iss_auto | curated
    confirmed    BOOLEAN NOT NULL DEFAULT FALSE, -- прошло ручную проверку
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Пайплайн актуализации из ISS (**по кнопке**)

Реализовано в `FuturesAssetClassifier.RefreshAsync` (эндпоинт `POST /api/exchanges/asset-classes/refresh`):

1. Тянем все FORTS-фьючерсы (`GET …/engines/futures/markets/forts/securities`) → множество
   различных `ASSETCODE` + представитель-`SECID` на каждый код.
2. Каждый код классифицируем: сначала **сид-карта `s205`** (`FuturesAssetTaxonomy.Seed` — валюта/
   ставки/товары/крипто- и спец-индексы), иначе — читаем **`GROUPTYPE`** («Группа контрактов»)
   из описания представителя `GET /iss/securities/{SECID}.json?iss.only=description` →
   `CategoryFromGroupType` (Акции/Валюта/Индексы/Товары/Ставки), иначе `other`.
   ⚠️ Резолв `q=<ASSETCODE>` НЕ используется: код фьючерса ≠ тикер акции (`SBRF`≠`SBER`).
3. `UpsertAutoAsync`: новые коды вставляются с `confirmed=false`; строки с `confirmed=true` (ручное
   курирование) **не перезатираются**. Возвращаем сводку `{total, inserted, unresolved}`.
4. Курирование поверх авто (подтверждение/правка `category`) — следующий шаг (пока `other`/новые
   помечаются «на проверку»). Появление нового `ASSETCODE` — кандидат в ленту новостей (§3d).

> Таймерная авто-актуализация намеренно НЕ вводится: обновление справочника — явное действие
> оператора (кнопка), чтобы контролировать обращения к ISS и момент изменения таксономии.

### Фильтры UI (общий интерфейс `[+] [x] … [Поиск]`, набор — по виду инструмента)

> **Статус: реализовано.** Общий (generic) интерфейс плашек вынесен в `web/src/ui/components/filters/`
> (`FilterBar`/`FilterChips`/`FilterSearch` + `filterModel`), не завязан на стор. На него переведена
> панель провайдеров (плашки Инструмент/Выбор/Биржи — тонкий адаптер над `OhsStore`) и раздел «Биржи».

- **Интерфейс один**: `[+]` добавляет плашку, значение выбирается в поповере (`single`=радио /
  `multi`=чекбоксы), плашка снимается своим `×` или общим «сбросить всё»; справа — «Найдено: N» и поиск.
- **Набор фильтров зависит от вида инструмента.** Пока для **фьючерсов FORTS** (`engine=futures`,
  `market=forts`) — две плашки (обе `multi`):
  - **Категория** — из справочника `futures_asset_class` (join по `ASSETCODE`); опции = категории,
    присутствующие в бордe, со счётчиками.
  - **Тип** (срок контракта) — вычисляется клиентски (`core/futuresContract.ts`): бессрочные
    (тикер `…F`/без экспирации) · квартальные (месяц 3/6/9/12) · месячные (прочие). Требует полей ISS
    `LASTTRADEDATE`/`SECTYPE` (добавлены в `IssSecurityDto`).
  - Между плашками — И, внутри плашки — ИЛИ; фильтрация и поиск — клиентские над списком борда.
- У других видов (Индексы/Акции/Валюта/Опционы) будут свои наборы плашек — расширяется добавлением
  описаний фильтров под конкретный борд (реестр по виду).

### Связь с UI

Категория (`category`/`subcategory`) отдаётся вместе с инструментом борда и питает **динамические
фильтры-плашки** (Индексы/Акции/Валюта/Ставки/Товары) — механика как в каталоге phase 7d
(плашки Инструмент/Выбор/Биржи). Двухуровневое представление на странице «Структура»: категория →
базовый актив (`ASSETCODE`) → контракты (экспирации).

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
