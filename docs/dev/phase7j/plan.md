# Phase 7j — Расписание соединения (Connection schedule)

**Статус:** `IN PROGRESS`. Зависимости: **7h / 7h.8** (автомат связи, `link_liveness`, лента Connection),
**7c** (календарь ISS / `IMarketCalendar`), **7e** (тумблер связи). Соседняя **7i** (Auto записи) —
проекция: запись вооружается, когда связь жива; connect/disconnect по расписанию — зона 7j.
Контекст — [../../promt.md](../../promt.md). Детали реализации — [apply.md](apply.md); статус —
[report.md](report.md).

## Проблема

Связь с брокером поднимается вручную (тумблер в шапке провайдера). Ночной/выходной присмотр,
обрывы и повторные connect — на операторе. Лента Connection (7h.8) уже показывает факт связи, но
**политики «когда держать линк»** нет: нет окна суток, нет Auto, нет журнала «какое окно пробовали
и почему отказались расширять».

Запись (7i) сознательно **не** поднимает связь (TRANSAQ process-global). Значит владельцем
расписания connect должен быть слой Connection.

## Идея

У **Connection** — своё расписание (проще биржевого: только `window_start` / `window_end`, без
внутридневных фаз) и **Auto**, зеркальный записи:

- Auto on → Supervisor сам включает/выключает тумблер связи по окну + календарю дней ведущего `engine`;
- ручной off тумблера связи → Auto off;
- ручной connect при Auto off — без расписания;
- лента Connection / `link_liveness` — факт; запись и её лента — **проекция** живой связи (7h.8d —
  follow-up).

История окон — SCD-2 (операционная память: «неделю назад уже расширяли — брокер рвал»).

## Зависимости

| Фаза | Что даёт 7j |
|------|-------------|
| 7e | Тумблер связи в `ProviderCard` (не двигаем) |
| 7h | `ConnectionManager`, `server_status`, reconnect, `LivenessProbe` 15 с |
| 7h.8 | `link_liveness`, `ConnectionRibbon` |
| 7c | `IMarketCalendar` — торговые дни ведущего `engine` |
| 11 (частично) | Тонкий notify-hub для кодов lifecycle; полный 11.2 — перспектива |

## Модель слоёв

```text
connection_schedule → ConnectionSupervisor → ConnectionManager → link_liveness / Ribbon
                              ↓ link live
recording_schedule  → RecordingSupervisor  → RecordingManager / coverage
```

## Область (MVP)

- Таблица `connection_schedule` (V021): SCD-2 по окну; `mode` (Auto) — UPDATE in-place.
- `ConnectionSupervisor`: тик 15 с (= `LivenessProbeSeconds`), nudge после PUT, retry Connect ×5.
- Анти-DDoS: не connect/probe в non-trading и вне окна; probe только в биржевой сессии при тишине.
- API GET/PUT schedule + history; notify-коды lifecycle → док.
- UI: в полосе `Связь · Finam` — **[Auto][Расписание]**; тумблер связи в ProviderCard как есть;
  popover окна (ось open/close, пресеты MOEX ± N ч, Утвердить → confirm).

## Вне области

- 7h.8d (сегмент через обрыв + красная проекция на инструмент).
- Персист кредов (MVP = Local / in-memory).
- Join календарей рынков; `changed_by` (phase 10).
- Полный phase 11.2 beyond connection-кодов.

## Критерии приёмки

1. Auto + утверждённое окно → connect в окне / disconnect вне; в non-trading днях ведущего `engine`
   связь по Auto не поднимается.
2. Ручной disconnect тумблера → Auto off; ручной connect при Auto off работает без расписания.
3. Auto без утверждённого окна включить нельзя.
4. Смена окна → новая SCD-2 версия (+ note/source); клик Auto → UPDATE `mode`, без новой версии.
5. После 5 неудачных Connect — notify error; Finam не долбится tight-loop / в выходные.
6. Lifecycle-события видны в notification center.
7. `tsc` + vitest + backend-тесты зелёные.

## Зафиксированные решения

1. **`engine`:** один ведущий календарь, без join; FORTS/`futures` обычно шире — выходных почти нет.
2. **Креды:** MVP Local; персист — отдельно.
3. **UI:** тумблер связи не двигаем; Auto в панели Связь управляет им.
4. **Auto без schedule:** запрещён.
5. **Notify:** тонкий hub в 7j; полный 11.2 — перспектива.
6. **Retry:** ~5–10 с между попытками ×5.
7. **История окон:** SCD-2; опечатка → новый пуш + note; `changed_at` не нужен.
