# Phase 7j — Расписание соединения (Connection schedule)

> **Эволюция фазы.** v1 MVP (одно окно суток, V021) → **v2 якорная модель** (`open+duration`,
> слоистые правила `main/dow/date`, SCD-2 — [v2-exceptions.md](v2-exceptions.md)) → Notification
> Composer + UI diff-approve (7j.13/14) → **обработка исключений редактирования** (7j.17: атомарный
> `batch`/Saga + глобальный exception-handler — [error-handling.md](error-handling.md)) → **Auto Connect:
> исключения и инциденты** (7j.18 — [auto-connect.md](auto-connect.md)). Живой статус — [report.md](report.md).

**Статус:** ядро `DONE`; **активная задача — 7j.18 Auto Connect (все исключения + инциденты)**;
в очереди — 7j.15 (рыночный профиль) / 7j.16 (`date`-авторинг). Зависимости: **7h / 7h.8**
(автомат связи, `link_liveness`, лента Connection), **7c** (`IMarketCalendar`), **7e** (тумблер связи).
Соседняя **7i** (Auto записи) — проекция живой связи. Детали реализации — [apply.md](apply.md);
статус/лог — [report.md](report.md). **Обновлено:** 2026-07-23.

## Проблема

Связь с брокером поднимается вручную (тумблер в шапке провайдера). Ночной/выходной присмотр, обрывы
и повторные connect — на операторе. Лента Connection (7h.8) показывает факт связи, но **политики
«когда держать линк»** нет. И даже с расписанием: если авто-connect сбоит, связь рвётся, ретраи не
удаются — оператор должен это **видеть в Notification Center** единообразно, а не догадываться.

Запись (7i) сознательно **не** поднимает связь (TRANSAQ process-global) — владельцем расписания
connect является слой Connection.

## Идея

У **Connection** — своё расписание (якорь `open+duration` + слоистые исключения `main/dow/date`) и
**Auto**, зеркальный записи:

- Auto on → `ConnectionSupervisor` включает/выключает тумблер связи по окну + календарю ведущего `engine`;
- ручной off тумблера → Auto off; ручной connect при Auto off — без расписания;
- лента Connection / `link_liveness` — факт; запись и её лента — проекция живой связи;
- **все исключения и инциденты** (обрыв, ретраи, исчерпание попыток, ошибки БД, необработанные
  исключения) → в NC по единому стандарту (имя, severity, группировка) — как у редактирования (7j.17).

История правил — SCD-2 (операционная память).

## Зависимости

| Фаза | Что даёт 7j |
|------|-------------|
| 7e | Тумблер связи в `ProviderCard` (не двигаем) |
| 7h | `ConnectionManager`, `server_status`, reconnect, `LivenessProbe` 15 с |
| 7h.8 | `link_liveness`, `ConnectionRibbon`, ось инцидента связи |
| 7c | `IMarketCalendar` — торговые дни ведущего `engine` |
| 11 (тонкий срез) | `NotificationHub`/`INotificationPublisher` (Publish + инцидентная ось Open/Progress/Resolve); полный 11.2 — перспектива |

## Модель слоёв

```text
connection_schedule → ConnectionSupervisor → ConnectionManager → link_liveness / Ribbon
                              ↓ link live
recording_schedule  → RecordingSupervisor  → RecordingManager / coverage
```

## Дорожная карта под-фаз

Живой статус и лог — [report.md](report.md); ниже — scope и указатели.

| # | Область | Статус | Док |
|---|---------|--------|-----|
| 7j.1–7j.5 | v1 MVP: V021 окно + store/API + Supervisor + notify + UI + тесты | DONE (заменено v2) | — |
| 7j.6–7j.12 | **v2:** V024 якорь + слоистые правила, домен/резолвер, стор, супервизор, API, фронт, тесты | DONE | [v2-exceptions.md](v2-exceptions.md) |
| 7j.13 | Notification Composer (одно user + одно system на пачку) | DONE | [notify-composer.md](notify-composer.md) |
| 7j.14 | UI: двухшаговый diff-approve, guardrail main, live-push баннер | DONE | [ui-schedule.md](ui-schedule.md) |
| 7j.17 | Обработка исключений **редактирования**: атомарный `POST …/schedule/batch` (Saga) + глобальный `IExceptionHandler` + severity-модель + попап без оптимизма | DONE | [error-handling.md](error-handling.md) |
| **7j.18** | **Auto Connect: все исключения + инциденты** (см. ниже) | **PLANNED (активная)** | [auto-connect.md](auto-connect.md) |
| 7j.15 | Рыночный/календарный профиль на settings; UI без хардкода MOEX | PLANNED | [market-profile.md](market-profile.md) |
| 7j.16 | `date`-авторинг на фронте + пагинация графика по месяцам | PLANNED | [todo.md](todo.md) |

## Активная задача — 7j.18: Auto Connect по расписанию (исключения + инциденты)

### Цель

Довести авто-подключение по расписанию и обработку инцидентов связи до продакшн-уровня: связь
поднимается / держится / гасится по расписанию, а **все исключения и инциденты** (обрыв, ретраи,
исчерпание попыток, ошибки БД/инфраструктуры, необработанные исключения) видны в NC в **едином
стандарте** 7j.17 — с именем подключения, осмысленной severity и группировкой в один сворачиваемый
сеанс/инцидент.

Эталон уже существует — **ручной connect** (`POST …/connect`): user-intent + system-серия
`connecting(warning)→connected(ok)/failed(error)` на общем `correlationId`, имя `«{name}»`. Задача —
подтянуть авто-путь (`ConnectionSupervisor`) и инциденты (`ConnectionManager`) к этому эталону.

### Область (scope)

1. **Единый стандарт рантайм-NC** (наследует 7j.17):
   - имя `Подключение {id} («{name}»)` (id первичен) во всех строках supervisor/manager;
     в системном техаудите допускается только `{id}`;
   - severity по смыслу перехода: `connecting/reconnecting = warning`, `connected/recovered = ok`,
     `lost/connect_failed = error`, `schedule_disconnect = info`;
   - source: намерение оператора = `user`, исполнение/инциденты = `system`;
   - `correlationId`: авто-серия попыток и инцидент связи сворачиваются каждый под один corr.
2. **Резолв имени:** helper с кэшем в `ConnectionManager` (`ResolveLabelAsync`/`ConnLabel`);
   `ConnectionSupervisor` берёт имя через него.
3. **`ConnectionSupervisor`:** имя во всех строках; `connected → ok`; `connecting → warning + underway`;
   общий `correlationId` на авто-серию; `schedule_disconnect` с именем.
4. **`ConnectionManager`:** имя в `lost`/`recovered`/`reconnecting` (инцидентная ось
   Open→Progress→Resolve по `LinkIncidentSubject` уже корректна — правится только presentation).
5. **Каталог рантайм-NC** — [auto-connect.md](auto-connect.md) §5; перекрёстная ссылка из
   [error-handling.md](error-handling.md) (единый каталог NC фазы).
6. **Инфра-ошибки авто-connect:** ретраи не глотают исключение молча; после исчерпания попыток —
   `connect_failed` (error) в NC (свериться/закрепить); необработанное — `GlobalExceptionHandler` (7j.17).
7. **Тесты/приёмка:** synthetic → живой прогон на Finam id=3 (анти-DDoS: реальный Finam не ронять
   tight-loop / в выходные).

### Вне области (7j.18)

- Персист кредов для ночного Auto (отдельно).
- Полный phase 11.2 (user-actions/фильтры сверх connection-кодов).
- Market/calendar profile (7j.15), `date`-авторинг (7j.16).

### Критерии приёмки (7j.18)

| # | Сценарий | Ожидаемая лента NC |
|---|----------|--------------------|
| 1 | Окно наступило, connect с 1-й попытки | `connecting`(warning) → `connected`(ok), один corr, имя во всех |
| 2 | Авто-connect: 2 фейла + успех | `connecting` ×3 (warning) → `connected`(ok), один corr |
| 3 | Авто-connect: исчерпаны попытки | `connecting` ×max → `connect_failed`(error), один corr |
| 4 | Вне окна / non-trading | `schedule_disconnect`(info) с именем |
| 5 | Обрыв во время окна | `lost`(error, Open) → `reconnecting`(warning, Progress) → `recovered`(ok, Resolve), один инцидент-corr |
| 6 | Ручной connect (регресс) | без изменений (эталон не задет) |
| 7 | Сборка/тесты | `dotnet build` solution + тесты зелёные |

## Критерии приёмки фазы

1. Auto + утверждённое расписание → connect в окне / disconnect вне; в non-trading днях ведущего
   `engine` связь по Auto не поднимается.
2. Ручной disconnect тумблера → Auto off; ручной connect при Auto off работает без расписания.
3. Auto без живых правил включить нельзя.
4. Правка расписания → атомарно (Saga, 7j.17): всё-или-ничего, без частичной записи; на сбое —
   попап остаётся с баннером + Retry, в NC — error.
5. После N неудачных Connect — `connect_failed` (error) в NC; Finam не долбится tight-loop / в выходные.
6. **Все lifecycle-события и инциденты связи видны в NC в едином стандарте** (имя, severity,
   группировка) — 7j.18.
7. `tsc` + vitest + backend-тесты + `dotnet build` solution зелёные.

## Зафиксированные решения

1. **`engine`:** один ведущий календарь, без join.
2. **Креды:** MVP Local; персист — отдельно.
3. **UI:** тумблер связи не двигаем; Auto в панели Связь управляет им.
4. **Auto без расписания:** запрещён.
5. **Notify:** тонкий hub в 7j (Publish + инцидентная ось); полный 11.2 — перспектива.
6. **Retry:** пауза ~8 с между попытками, ×5.
7. **История правил:** SCD-2; опечатка → новый пуш + note.
8. **Именование NC:** `Подключение/Расписание {id} («{name}»)` — id первичен; в системных — только id.
9. **Severity по смыслу перехода:** позитивный переход = `ok`; в процессе = `warning`; сбой =
   `error`/`critical`.
10. **Атомарность правок:** редактирование расписания — атомарный `batch` (Saga), без частичной записи.
11. **Safety-net:** глобальный `IExceptionHandler` → `ohs.unhandled` (system·critical).
12. **Оптимизм в UI:** попап расписания не закрывается на сбое (баннер + «Повторить»).
