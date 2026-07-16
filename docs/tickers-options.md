# Опционы TRANSAQ: каталог, запрос в поддержку и решение

**Дата:** 2026-07-16.  
**Контекст:** Online History Server (OHS), коннектор Finam / TRANSAQ XML (`tr1.finam.ru:3900`).  
**Краткий порядок действий (для реализации):** [`dev/phase7i/issue.md`](dev/phase7i/issue.md).

---

## 1. Проблема

### Что нужно бизнесу

Писать сделки по опционам RTS вокруг ATM (ориентир ±15 страйков от цены базового
фьючерса), без необходимости тащить всю цепочку опционов в каталог.

Пример целевых тикеров (серия M7, экспирация **16.07.2026**, базовый **RTS-9.26** / `RIU6`):

| Тикер | Смысл |
|-------|--------|
| `RI82500BG6` | Call 82500 на RTS-9.26 |
| `RI85000BG6` | Call 85000 на RTS-9.26 |

На **MOEX ISS** эти инструменты существуют и торгуются.

### Что видели в OHS

1. После `connect` в dump `<securities>` от TRANSAQ приходили фьючи / акции / …, а набор
   **RI OPT** был неполным: в БД оказывались в основном **дальние OTM**, без страйков
   около ~82500–85000 (ATM при clearing `RIU6` ~83990).
2. Диагностический endpoint `POST /api/connections/{id}/probe-security` шлёт
   `get_securities_info` с `market` + `seccode`.
3. Результаты probe (Finam connected, 2026-07-16):

| seccode | commandAccepted | found | Комментарий |
|---------|-----------------|-------|-------------|
| `RIU6` | true | true | Фьючерс RTS-9.26 |
| `SiU6` | true | true | Фьючерс Si-9.26 |
| `SBER` | true | true | Акция |
| `Si80000BG6` | true | true | Опцион Si ATM, exp 16.07 |
| **`RI82500BG6`** | **false** | **false** | `'secid' or 'seccode' and 'market' elements not found` |
| **`RI85000BG6`** | **false** | **false** | То же |
| `RI082500BG6` | false | false | Неверный код (лишний `0`; на ISS корректный — `RI82500BG6`) |

Формат XML для `get_securities_info` при этом **верный** (подтверждается успешными
ответами по `Si80000BG6` / `RIU6`). Ошибка про `secid`/`market` у шлюза в данном случае
означает скорее «инструмент **неизвестен сессии**», а не битый XML.

### Исходная гипотеза (до ответа поддержки)

Каталог OPT строится **только** из того, что TRANSAQ сам прислал в `<securities>` при
connect. Раз ATM RI нет в dump и `get_securities_info` их не находит — либо ограничение
доступа/тарифа, либо неполная синхронизация справочника FORTS на стороне Finam.

Отсюда — обращение в поддержку.

---

## 2. Запрос в поддержку (полный текст)

Ниже — письмо, подготовленное и отправленное в поддержку TRANSAQ / Finam
(тема: отсутствие ATM-опционов RTS в справочнике при наличии на бирже).

---

**Тема:** В справочнике TRANSAQ отсутствуют опционы RTS ATM (RI82500BG6, RI85000BG6), хотя на бирже они есть

Здравствуйте.

Подключаюсь к TRANSAQ XML Connector (Finam, `tr1.finam.ru:3900`) для сбора рыночных данных по FORTS.

**Проблема:** в справочнике TRANSAQ (`<securities>` при connect и `get_securities_info`) отсутствуют опционы RTS с ATM-страйками, хотя на MOEX ISS они торгуются.

**Что работает:**
- фьючерс `RIU6` (RTS-9.26) — есть в справочнике;
- опцион `Si80000BG6` (Si-9.26, Call 80000, exp 16.07.2026) — `get_securities_info` возвращает `<sec_info>`;
- команда `get_securities_info` с `market=4` + `seccode` отрабатывает корректно.

**Что не работает:**
- `RI82500BG6` — `get_securities_info` → `success=false`, сообщение: `'secid' or 'seccode' and 'market' elements not found`;
- `RI85000BG6` — то же;
- эти коды **не приходят** в `<securities>` при подключении (в каталоге только дальние OTM RI OPT, без страйков ~82500–85000).

**Пример запроса:**
```xml
<command id="get_securities_info">
  <security>
    <market>4</market>
    <seccode>RI82500BG6</seccode>
  </security>
</command>
```

**На MOEX ISS** инструменты существуют, например:
- `RI82500BG6` — RTS-9.26, Call 82500, серия M7, экспирация 16.07.2026
- `RI85000BG6` — RTS-9.26, Call 85000, та же серия

**Вопросы:**
1. Почему эти RI-опционы не попадают в справочник TRANSAQ?
2. Это ограничение тарифа/доступа или ошибка синхронизации справочника FORTS?
3. Как получить полный справочник опционов RTS по серии M7 (exp 16.07.2026), включая ATM-страйки?
4. Нужна ли отдельная подписка или настройка для опционов RTS?

**Данные для воспроизведения:**
- Логин TRANSAQ: `[логин]`
- Хост: `tr1.finam.ru:3900`
- Дата проверки: 16.07.2026
- Базовый актив: RTS-9.26 (`RIU6`), clearing ~83990

Готов предоставить логи коннектора (`logs/transaq`) и XML-ответы по запросу.

С уважением,  
[…]

---

Краткая формулировка (для чата поддержки), если нужна короткая версия того же запроса:

> При connect на `tr1.finam.ru` в `<securities>` нет RI OPT ATM (RI82500BG6, RI85000BG6), хотя на MOEX они есть. `get_securities_info market=4 seccode=RI82500BG6` → not found. Si OPT (Si80000BG6) приходит. Почему RI OPT не синхронизируются? Логин: XXX.

---

## 3. Ответ поддержки (полный текст)

Цитата ответа **целиком**, как получен:

---

Здравствуйте! Получили ответ. Порядок действия для получения подписки на опционы:

1. Подключиться
2. Получить первичные сообщения markets, candlesticks, securities
3. Подписаться на нужные фьючерсы по одному.
4. По всем нужным фьючерсам запросить get_option_families
5. После получения option_families запросить get_family_strikes
6. Вызвать команду get_options:
```xml
<command id="get_options">
<opt_code>тиккер опциона :string</opt_code>
<opt_code>тиккер опциона :string</opt_code>
…
<opt_code>тиккер опциона :string</opt_code>
</сommand>
```
Результатом команды является структура `<securities>` или `< options_failed>`
Использовать нужно opt_code из family_strikes.
7. После получения securities с опционами страйков, запросить по ним подписку (subscribe)

Это ответ поддержки

---

(Опечатка в закрывающем теге `</сommand>` с кириллической «с» — в ответе поддержки; в коде
использовать ASCII `</command>`.)

---

## 4. Что это значит (разбор ответа)

Поддержка **не** подтвердила баг справочника и **не** указала на тарифный запрет RI OPT.
Она описала **отдельный протокол загрузки опционов**:

1. Первичный `<securities>` после connect — **не** полный каталог опционов.
2. Опционы нужно **явно запросить** через:
   - `get_option_families` (по базовому фьючерсу),
   - `get_family_strikes` (семейство + дата экспирации → список `opt_code`),
   - `get_options` (пакет `opt_code` → `<securities>` либо `<options_failed>`).
3. Тикеры для `get_options` брать **только** из `family_strikes`, а не «с улицы» / только с ISS.
4. Подписка на сделки по опционам (`subscribe`) — **после** того, как шлюз вернул их в
   `<securities>` шага `get_options`.

Отсюда следствие для наших probe:

- `found=false` по `RI82500BG6` **до** цепочки — ожидаемо: инструмент ещё не загружен в сессию.
- Успех `Si80000BG6` не опровергает протокол: тот код уже мог оказаться в сессии иным путём;
  для RI ATM мы цепочку **не** выполняли.

Документация TRANSAQ (TXmlConnector): команды `get_option_families` (3.35),
`get_family_strikes` (3.36), `get_options` (3.37); callback-структуры
`<option_families>`, `<family_strikes>`, `<options_failed>` (разделы 4.38–4.40).
Команды появились в билде **2.21.19** (changelog 07.07.2022).

---

## 5. Решение

### Продуктовое

Не ждать «полного OPT» из connect-dump. Для нужных базовых фьючерсов (как минимум `RIU6`,
при необходимости `SiU6` и др.) реализовать в OHS **явный load опционов**:

```
connect
  → дождаться markets / candlesticks / securities
  → subscribe на базовый FUT (по одному)
  → get_option_families
  → get_family_strikes (выбранная mat_date / семейство)
  → отфильтровать opt_code (например ±N страйков от ATM / выбранные коды)
  → get_options
  → upsert <securities> в каталог OHS
  → subscribe на выбранные OPT → запись
```

Критерий готовности к записи по опциону: он есть в каталоге **после** успешного
`get_options` (и при желании подтверждён `get_securities_info` / probe).

### Техническое (TBD в коде)

В репозитории на момент фиксации issue:

- команд `get_option_families` / `get_family_strikes` / `get_options` в
  `Scinverse.Ohs.Connectors.Transaq` **нет**;
- ingest каталога опирается на входящие `<securities>` (в т.ч. connect-dump);
- диагностический `probe-security` полезен **после** шага `get_options`, не вместо него.

Рекомендуемый следующий шаг реализации: сервис/метод на живой TRANSAQ-сессии
(например `LoadOptionsAsync(connectionId, underlyingBoard, underlyingSeccode, matDate, …)`)
+ опционально HTTP endpoint для ручной проверки; затем UI/Auto завязать на наличие OPT в каталоге.

Рабочий чеклист порядка — в [`dev/phase7i/issue.md`](dev/phase7i/issue.md).

---

## 6. Связанные артефакты

| Артефакт | Назначение |
|----------|------------|
| [`dev/phase7i/issue.md`](dev/phase7i/issue.md) | Короткий issue: порядок 1–7 для реализации |
| [`dev/phase7h/issue.md`](dev/phase7h/issue.md) | Reconnect / тумблер; смежно упомянут неполный OPT dump |
| `POST /api/connections/{id}/probe-security` | Диагностика `get_securities_info` после load |
| TXmlConnector PDF §§ 3.35–3.37, 4.38–4.40 | Официальная спецификация команд опционов |
