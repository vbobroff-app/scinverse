# Phase 7i. Issue: подписка на опционы TRANSAQ (порядок действий)

Опционы FORTS **не входят** в первичный dump `<securities>` при connect.
Чтобы получить страйки (в т.ч. ATM RI) в каталог и подписаться на сделки, нужна
явная цепочка команд TRANSAQ — подтверждена поддержкой Finam (2026-07-16).

**Статус:** `OPEN` (документация; реализация в коде — TBD). **Дата:** 2026-07-16.  
**Подробности, письмо в поддержку и ответ:** [`../../tickers-options.md`](../../tickers-options.md).  
**Смежное:** [../phase7h/issue.md](../phase7h/issue.md) (§ каталог опционов).

---

## Порядок действий (обязательный)

1. **Подключиться** (`connect`) к шлюзу TRANSAQ.
2. **Дождаться первичных сообщений:** `markets`, `candlesticks`, `securities`
   (в `securities` — рынки/акции/фьючи и т.п.; полный набор OPT здесь **не** ожидается).
3. **Подписаться на нужные фьючерсы по одному** (`subscribe` / alltrades на базовый FUT,
   например `RIU6@FUT`).
4. **По всем нужным фьючерсам** запросить `get_option_families`.
5. **После получения** `<option_families>` запросить `get_family_strikes`
   (семейство + `mat_date`).
6. **Вызвать** `get_options` со списком `opt_code` из `<family_strikes>`:

   ```xml
   <command id="get_options">
     <opt_code>тиккер опциона</opt_code>
     <opt_code>тиккер опциона</opt_code>
     …
   </command>
   ```

   Результат: структура `<securities>` **или** `<options_failed>`.  
   Использовать нужно **`opt_code` из `family_strikes`**, а не «угаданный» тикер с ISS.
7. **После** получения `<securities>` с опционами страйков — upsert в каталог OHS и
   **запросить подписку** (`subscribe`) на нужные опционы.

---

## Следствия для OHS

| Сейчас | Нужно |
|--------|--------|
| Каталог OPT = только то, что пришло в connect-dump | После connect — явный load: families → strikes → `get_options` |
| `get_securities_info` по ATM RI → «not found» | Ожидаемо **до** шага 6; после `get_options` — инструмент в сессии |
| Recording/Auto по OPT без предварительного load | Сначала цепочка выше, потом subscribe / запись |

В коде OHS команд `get_option_families` / `get_family_strikes` / `get_options` пока **нет**.

---

## Минимальный сценарий проверки (ручной)

1. Connect Finam → статус `waiting`/`active`.
2. Subscribe `RIU6` (FUT, market 4).
3. `get_option_families` → выбрать серию (например exp `16.07.2026`).
4. `get_family_strikes` → взять `opt_code` около ATM (~82500 / 85000).
5. `get_options` с этими `opt_code` → в ответе должны появиться `<securities>`.
6. Повторный `probe-security` / `get_securities_info` по `RI82500BG6` → `found=true`.
7. Subscribe на выбранные OPT → запись сделок.
