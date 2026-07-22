# Phase 7j — Рынок / календарный профиль расписания (план)

**Статус:** `PLANNED` (описание модели; фронт пока с хардкодом MOEX-пресетов).  
**Связано:** [v2-exceptions.md](v2-exceptions.md) (`connection_schedule_settings.engine`), [ui-schedule.md](ui-schedule.md), [todo.md](todo.md), [apply.md](apply.md).

---

## 1. Проблема

В модалке расписания пресеты жёстко завязаны на **MOEX** (срочный / фондовый / валютный). По смыслу рынок может быть любым: CME, другая биржа, другой календарь сессий.

Нужно зафиксировать в объектной модели, **куда** относится «рынок» для расписания связи — до того как расхардкодить UI.

---

## 2. Решение: профиль на соединении, не на правиле

**Правильно:** календарный / рыночный профиль — атрибут **schedule settings соединения**.  
**Неправильно:** `market` на каждом `ScheduleRule` (окно не «биржевое», а политика линка).

Связь уже создаётся «к чему-то» (брокер / venue / контур). Под неё получают инструменты и заводят расписание **этого** соединения. Пресеты и non-trading календарь — следствие профиля соединения, а не полей правила.

```
Connection
  └─ ScheduleSettings          ← Auto, tz, calendar / market profile
  └─ ScheduleRules[]           ← нейтральные окна (main / dow / date, open+duration)
         ↑
    UI-пресеты читают профиль settings → market_schedule / каталог сессий
```

Правило остаётся: «когда держать линк». Биржа нужна для:

1. **Календаря** non-trading (supervisor / `IMarketCalendar`);
2. **Каталога пресетов** в UI (подсказки open/close, shift).

---

## 3. Как сейчас

| Что | Где |
|-----|-----|
| `engine`, `tz`, `auto` | `connection_schedule_settings` (уровень соединения) |
| Правила `main` / `dow` / `date` | без поля рынка |
| Пресеты в UI | захардкожены MOEX + `GET market_schedule` по engine/market |
| Trading-day gate | `settings.engine` → календарь |

То есть домен уже ближе к «профиль на settings»; узок скорее **смысл `engine`**: сегодня это по сути MOEX-профиль (`futures` \| `stock` \| `currency`), не универсальный market ref.

---

## 4. Целевая модель (эволюция settings)

Без ломки правил — расширить / уточнить **settings**:

```
ScheduleSettings
  autoEnabled
  tz
  calendarProfile | marketRef   -- ключ в market_schedule + IMarketCalendar
  -- сегодняшнее engine: спецслучай / алиас MOEX-профиля до миграции
```

UI:

- пресеты = `listPresets(connection.schedule.settings.marketRef)` (или `calendarProfile`);
- без хардкода «MOEX срочный / …» в компоненте;
- смена профиля на settings → другой календарь и другой набор подсказок; **живые правила не переписываются** автоматически (окна абсолютные).

---

## 5. Что не делаем

- Не вешаем `market` / `engine` на строку правила.
- Не делаем расписание «общим на биржу» вне connection — владелец политики линка = соединение.
- Не смешиваем venue брокера (куда TCP/API) с calendar profile (когда торговый день / сессия) — связаны, но разные оси; профиль календаря живёт в schedule settings.

---

## 6. Чеклист реализации (позже)

- [ ] Имя поля: оставить `engine` vs ввести `calendarProfile` / `marketRef` (+ миграция / compat).
- [ ] Каталог профилей (MOEX futures/stock/currency, CME, …) и API пресетов.
- [ ] Supervisor: календарь только из settings профиля.
- [ ] Фронт: убрать хардкод `TEMPLATES` MOEX → пресеты от settings.
- [ ] Доки: обновить v2-exceptions / ui-schedule после внедрения.
