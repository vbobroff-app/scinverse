# Write Gaps — спека слоя записи (Writers Gantt)

**Статус:** `DONE` (2026-08-04) · API `POST /api/coverage/write-gaps` · UI `showWriteGaps`  

**Phase:** **7h** (Гант записи: честная подложка + классификация разрывов → recovery-красный).  
**Продукт (язык оператора):** [`docs/wiki-readme/write-gaps.md`](../../wiki-readme/write-gaps.md)

> Phase 7h historically DONE по подложке/liveness; этот документ — **follow-up to-be**
> (пересчёт красного на дорожке инструмента). План/report 7h будут обновляться под него.

**Зависимости:** геометрия 7h ([`incident.md`](incident.md) — намерение ∩ живость) ·
слой сделок 7g · journal `incident` (11.13 DONE) ·
[`schedule-projection.md`](../phase11/schedule-projection.md) / ScheduleCutter (P1.2) ·
Recording binary as-is — [`incident-journal.md`](../phase11/incident-journal.md) §3.0b
(**заменяется** этой моделью для красного на дорожке инструмента).

**Не трогать в этой спеке:** Connection-ribbon (break/crash/owner), NC Thread, soft-delete.

---

## 1. Канон (формулы)

```text
WriteHole  = expand(incident ∩ intention) → до ближайших сделок
             (влево: last trade до дыры; вправо: first trade после)
WriteGap   = ScheduleCutter(WriteHole ∩ desired)
```

| Термин | Определение |
|--------|-------------|
| **intention** | span `coverage_segment` (запись включена: manual Start или Recording Auto) |
| **incident** | эпизод journal `incident` (break / crash / stall…), пересекающий intention |
| **WriteHole** | интервал без сделок, якорь — пересечение с incident; **края по md_trade** |
| **desired** | SCD-2 / connection schedule windows (то же, что Auto + mask) |
| **WriteGap** | клип WriteHole в рабочее окно — единственный красный на Writers Gantt |

**Цвет:** один красный, без type/owner/маркеров. Причина — в journal / Connection-ленте.

---

## 2. Зачем отдельно от as-is Recording-red

As-is (11.13e): красный на инструменте = бинарный merge `incident` (полный span детекта).

Проблемы для recovery:

- границы incident **позже** пропажи сделок и **раньше** их возврата;
- ночные / вне-desired участки не отрезаны Cutter’ом;
- красный смешивает «связь мигала» и «что бэкапить».

To-be: красный = **кандидат восстановления** с точными trade-границами ∩ schedule.

---

## 3. Слои дорожки инструмента (to-be)

| # | Слой | Источник | Визуал | Изменение |
|---|------|----------|--------|-----------|
| 1 | Намерение | `coverage_segment` | приглушённый фон / серый stopped | as-is |
| 2 | Живость | `capture_liveness` | входит в подложку | as-is |
| 3 | Подложка | intention ∩ liveness | «честный» фон | as-is |
| 4 | Сделки | activity / `md_trade` buckets | яркие ячейки | as-is |
| 5 | **WriteGap** | формула §1 | сплошной red, **тумблер** | **новый расчёт** |

Подложка по-прежнему отличает тихий рынок (фон есть, ячеек нет) от обрыва живости.  
WriteGap отвечает только на: «нужна дозагрузка в этом интервале».

---

## 4. Алгоритм WriteHole

Вход (на `instrumentId` × `sourceId` / connection):

1. Сегменты intention в окне Ганта.
2. Инциденты connection (и scope crash), пересекающие эти сегменты; soft-deleted — **исключить**.
3. Для каждого кандидата:
   - `intention` = **envelope** записи инструмента (`min started_at` … `max ended_at` / now),
     не каждый `coverage_segment` по отдельности (иначе crash между сегментами → пустой ∩);
   - `core = incident_span ∩ intention` (если пусто — skip); инцидент должен лежать внутри
     интервала записи/сделок — без grace ±N мин;
   - `from = last_trade_ts` строго `< core.from` (или `core.from`, если сделок нет);
   - `to = first_trade_ts` строго `> core.to`; если нет и incident **open** — `to = now`
     (в пределах окна); иначе `core.to`;
   - результат — WriteHole `[from, to)` (края — реальные сделки, с секундами).
4. Несколько incident в одной тишине → **merge** перекрывающихся WriteHole (края всё равно
   по сделкам; достаточно одного якоря incident).

**SoT границ:** timestamps сделок в `md_trade`, не края activity-бакета.

**Тихий рынок:** intention ∧ нет сделок ∧ нет пересекающего incident → нет WriteHole.

**Тихий обрыв (stall):** `LivenessProbe` ping FAIL → `ReportStallAsync` → open incident
(левая граница ≈ last trade) → тот же алгоритм; отдельной ветки нет.

---

## 5. WriteGap = Cutter

```text
WriteGap = ScheduleCutter(WriteHole, desired_windows(connection))
```

- `desired` — то же расписание, что Auto connect и UI schedule mask (TZ, date>dow>main).
- Вне desired красного нет (void / не recovery-target).
- Open hole: `to = now ∩ desired` (Cutter отрежет будущее вне окна).
- Cutter **не** пишет в `incident` и **не** меняет NC.

P1.2 ScheduleCutter (phase 11 schedule-projection) — **блокер** серверного расчёта WriteGap;
UI-прототип может временно клиповать desired на клиенте тем же резолвером, что маска
(с пометкой tech-debt).

---

## 6. UI / API (контур)

| Элемент | Решение |
|---------|---------|
| Тумблер | Settings провайдера (рядом с «Гэпы в работе» / маской) — show WriteGap |
| Default | TBD при реализации (рекомендация: on для writers-view) |
| Отрисовка | `CoverageTrack`: слой red поверх подложки; **не** заменять ячейки сделок |
| Совместимость | Убрать/заменить as-is `incidentReds` merge на дорожке инструмента |
| Connection-ribbon | без изменений (полная семантика break/crash) |

API (черновик): либо расширить `/coverage/...` ответом `writeGaps[]`
`{ instrumentId, sourceId, from, to }`, либо считать на клиенте из
segments + incidents + trades + sessions — выбрать в apply по нагрузке
(предпочтение: сервер + Cutter, один SoT для будущего backfill).

---

## 7. Потребители

1. **Writers Gantt** — визуал (эта фаза / follow-up 7h).
2. **Recovery / backfill** (later) — входные интервалы «что дозагрузить»; параметры = WriteGap.

---

## 8. Критерии приёмки

1. Тихий рынок (intention + liveness + нет incident) → красного нет.
2. Break / crash / stall при intention → WriteHole с краями last/first trade (не span incident).
3. Вне desired → WriteGap пуст (или клипнут); внутри окна — красный.
4. Open incident → правый край растёт с now, clipped desired.
5. Тумблер скрывает/показывает только WriteGap; намерение/живость/подложка/сделки не ломаются.
6. Soft-deleted incident не порождает WriteHole.
7. Unit/vitest на expand + merge + cutter clip; живой Finam: stall → red с границей ≈ last trade.

---

## 9. Порядок внедрения (черновик)

| Шаг | Что |
|-----|-----|
| W1 | Документы (wiki + эта спека) — **этот коммит / чат** |
| W2 | Domain: `WriteHole` expand + merge (unit); границы из store сделок |
| W3 | `ScheduleCutter` wire (P1.2) → WriteGap |
| W4 | API или client projection + тумблер + `CoverageTrack` |
| W5 | Снять as-is incident binary red на инструменте; регресс Connection-ribbon |
| W6 | Приёмка §8 + обновить phase11 `incident-journal` §3.0b → pointer сюда |

---

## 10. Связанные документы

| Документ | Роль |
|----------|------|
| [`wiki-readme/write-gaps.md`](../../wiki-readme/write-gaps.md) | продукт |
| [`incident.md`](incident.md) | намерение ∩ живость (7h) |
| [`plan.md`](plan.md) · [`report.md`](report.md) | фаза 7h (подлежат обновлению) |
| [`schedule-projection.md`](../phase11/schedule-projection.md) §6 | Cutter |
| [`plan-schedule-projection.md`](../phase11/plan-schedule-projection.md) P1.2 | wire cutter |
| [`incident-journal.md`](../phase11/incident-journal.md) §3.0b | as-is Recording-red |
| [`wiki-readme/layers.md`](../../wiki-readme/layers.md) §5 | слой W |
