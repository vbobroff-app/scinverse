# Baskets · Observed (Наблюдаемые) · Available · Archive

Статус: **DRAFT канон** (2026-08-05). Не реализовано — продуктовая спека перед кодом.

Смежное: [`wiki-readme/catalog.md`](../wiki-readme/catalog.md) (lifecycle `active`, OPT ATM,
Refresh) · dump / `InstrumentRegistry` · Auto / recording (пишут только из Observed).

---

## 1. Зачем

Сейчас Online-каталог и hot-path записи смешаны: полный dump (тысячи инструментов) попадает
в кэш, а пишем/отслеживаем десятки. Нужно разделить:

- **широкий справочник** (что вообще можно получить);
- **рабочий набор** (что кэшируем и чем кормим список записи / Auto / connect).

---

## 2. Три слоя инструментов

| Слой | Имя в UI | Смысл | Где живёт |
|------|----------|--------|-----------|
| **Available** | (справочник / модалка наборов) | Все Online-доступные по lifecycle (`instrument.active = true`) | БД (+ ленивый UI), не hot-cache записи |
| **Observed** | Наблюдаемые | Union членов выбранных **baskets** — то, что кэшируем и показываем в основном списке записи | БД (членство) + in-memory кэш |
| **Archive** | Архив | Просроченные (`active = false`) | БД; не Online-запись |

Ось lifecycle (exp → archive) **не меняется**. Observed — ортогональный working set поверх Available.

**Auto / Start записи** — только из Observed (не из всего Available).

---

## 3. Basket (набор)

Пользователь создаёт наборы сам (как пользовательские списки в UI брокера).

```text
создать basket → имя (свободное) → тип → правила
```

Примеры имён (не зашиты в продукт): `CurrencyFutures`, `IndexFutures`, `OPT-Si`.

### 3.1 Типы (ровно два)

| Тип | Актуализация | Типичное содержимое |
|-----|----------------|-------------------|
| **`static`** | Раз в сутки (Lifecycle) и по кнопке **Refresh**; членство материализуется в БД | FUT (и явные OPT, если заданы glob'ом) |
| **`dynamic`** | Отдельный контур: следит за ценой БА, **дописывает** страйки в кэш из БД | OPT вокруг ATM |

Имена — только UX. В модели: `id`, `name`, `kind: static|dynamic`, `rules`, членство.

### 3.2 Правила (static)

- **Glob** по тикеру/secid, напр. `Si-*.*`, `Si-*.2?`, `RTS-*.[2-9]`, несколько паттернов на basket.
- В UI также **picker типа** (FUT / OPT) и, по возможности, underlying — плюс advanced glob.
- Матч: Available ∩ правила → кандидаты в членство (превью → OK).

### 3.3 Правила (dynamic) — OPT

Особое кэширование опционов:

1. Страйки уже есть в Available/БД (dump / `get_option_families` → strikes → `get_options`).
2. Следим за **ценой базового актива** (FUT, обычно из static Observed).
3. В кэш **подкидываем** страйки, попавшие в ATM ±N (из БД).
4. Уже попавшие в кэш **не выкидываем** до суточного Lifecycle / Refresh (**sticky expand**).

Так Observed/кэш не «пляшет» на каждом тике last, но окно расширяется при движении цены.

Параметры dynamic (TBD в реализации): глубина ±N (может совпадать с `Ohs:OptionAtmDepth`),
ссылка на БА / parent FUT, частота опроса цены.

---

## 4. Суточный Lifecycle vs connect / crash

### 4.1 Утро / Lifecycle (и кнопка Refresh)

1. **Available** — сверить с источником (dump / invalidate): полный Online-список в БД;
   новые контракты месяца появляются здесь; просроченные → Archive.
2. **Static baskets** — eval правил по Available → обновить членство в БД.
3. **Dynamic baskets** — seed окна ATM (и при Refresh — политика сброса sticky: сбросить и
   набрать заново, либо только расширить; **default Refresh: сброс OPT-окон**, как сейчас
   catalog refresh).
4. **Кэш** — загрузить Observed (union baskets) в memory.

Контракты обычно листятся заранее; mid-day сюрприз → оператор жмёт **Refresh**.

### 4.2 Connect / reconnect

Работаем **только с in-memory кэшем Observed** (мало инструментов).  
Полный dump при connect по-прежнему может обновить **Available в БД**; в hot-cache мержим
только то, что входит в Observed (после суточного снимка — без полного re-eval на каждый
connect).

### 4.3 Crash / рестарт Host

In-memory кэш слетает. **Не** гоняем правила заново:

1. Прочитать из БД готовое членство Observed (утренний / последний Refresh снимок).
2. Поднять кэш.
3. Dynamic: продолжить sticky expand в сессии (цена БА → новые страйки из БД).

Правила baskets хранятся в БД (intent); членство static — материализованный снимок.

---

## 5. UI

| Поверхность | Поведение |
|-------------|-----------|
| Основной список записи | Только **Observed** = union отмеченных наборов |
| Фильтр «Наборы» | ☑ имя basket … — галки включают/выключают набор в union |
| Модалка baskets | Создать / имя / тип / правила / превью match → OK |
| Available | Отдельный UI: просмотр, превью правил, **добавить** в basket (не основной список) |

---

## 6. Связь с текущим Refresh каталога

Текущая кнопка Refresh (кэш dump + lifecycle archive) остаётся и **расширяется** смыслом:

- обновить Available (dump / invalidate);
- archive по exp;
- re-eval static baskets;
- reset/reseed dynamic OPT окон;
- пересобрать Observed-кэш.

NC: по-прежнему отдельные corr (cache vs lifecycle); baskets eval можно шагом внутри
lifecycle/cache — детали emit TBD.

---

## 7. TBD (не блокируют канон слоёв)

| # | Вопрос | Заметка |
|---|--------|---------|
| T1 | Синтаксис glob + поле матча (`ticker` / `seccode` / `shortname`) | Зафиксировать в реализации + тесты |
| T2 | Dynamic: ±N, выбор БА, период опроса last | Default: `OptionAtmDepth`, parent FUT из правила basket |
| T3 | Refresh dynamic: полный сброс sticky vs только expand | Default: сброс окон OPT (как сейчас) |
| T4 | Миграция текущего UI (Si/RTS/SBRF) → первый static basket | Ручной или seed при первом запуске |
| T5 | Схема БД: `instrument_basket`, `basket_rule`, `basket_member` | Миграция отдельно |

---

## 8. Вне scope этой спеки

- Intraday `sec_status` (в сессии / нет) — отдельная ось.
- History/backfill по архиву.
- Автоматический mid-day re-eval static без Refresh.
- Зашитые имена наборов в продукте.
