# Phase 7i. Issue: подписка на опционы TRANSAQ (порядок действий)

Опционы FORTS **не входят** в первичный dump `<securities>` при connect.
Чтобы получить страйки (в т.ч. ATM RI) в каталог и подписаться на сделки, нужна
явная цепочка команд TRANSAQ — подтверждена поддержкой Finam (2026-07-16).

**Статус:** `DONE` (2026-08-04). Online: ATM ±N → каталог + expand/Auto.  
**Подробности, письмо в поддержку и ответ:** [`../../tickers-options.md`](../../tickers-options.md).  
**Смежное:** [../phase7h/issue.md](../phase7h/issue.md) (§ каталог опционов).  
**Канон осей / UX:** [../../wiki-readme/catalog.md](../../wiki-readme/catalog.md),
[../../architecture/db-design.md](../../architecture/db-design.md) (§ Online lifecycle + OPT).

**Вне этого issue:** History / полный каталог / `gethistorydata` / WG.1; intraday `sec_status`
(7b.2 / 7c.9); UI-глубина ATM (только `Ohs:OptionAtmDepth`).

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

## Реализация в OHS (DONE)

| Слой | Что |
|------|-----|
| Connector | `IOptionCatalogLoader` / `TransaqConnector`: families → strikes → `get_options` |
| Host | `OptionCatalogService.EnsureOptionsAsync` + `OptionWindowFreshness` (сутки МСК) |
| ATM | live trade FUT → fallback last `md_trade`; глубина `Ohs:OptionAtmDepth` (default 15) |
| API | `GET …/option-families`, `POST …/load-options`; force `POST /instruments/catalog/refresh` |
| Web | expand FUT без `hasOptions`; ensure перед strikes; кнопка Refresh + confirm |
| NC | два corr: кэш справочника / актуальность (lifecycle) |
| Lifecycle | `instrument.active` = Online vs архив по `expiration` (sweep + upsert) |

---

## Минимальный сценарий проверки (ручной)

1. Connect Finam → статус `waiting`/`active`.
2. Раскрыть FUT без OPT в БД → серии из `option-families`.
3. Раскрыть серию → ATM ±N в каталоге / страйки в дереве.
4. Повторный expand в тот же день — без полного reload (freshness).
5. Refresh → confirm → в NC два процесса; после reconnect dump; архив по exp.
6. Subscribe / запись на выбранные OPT.
