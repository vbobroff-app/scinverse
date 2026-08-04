# Phase 8. Отчёт о выполнении

**Текущий статус:** `DONE` (код). Документация home — 2026-08-04 (перенос из phase 11).
Канон: [incident-journal.md](incident-journal.md) · [incident-soft-delete.md](incident-soft-delete.md) ·
[crash-dispatch.md](crash-dispatch.md) · [schedule-projection.md](schedule-projection.md).

NC Thread / dock — [../phase11/report.md](../phase11/report.md) (Stage 2 продукт).

## Статус задач

| # | Бывш. | Задача | Статус | Комментарий |
| - | ----- | ------ | ------ | ----------- |
| 8.1 | 11.13a | `V028` + `IIncidentStore` | DONE | DbUp + integration tests |
| 8.2 | 11.13b | `JournalRegistrator` + wire | DONE | break-пути + unit; crash open — 8.6 |
| 8.3 | 11.13c | REST incidents API | DONE | list/detail/by-connection + `durationMs` |
| 8.4 | 11.13d | UI журнал в Admin web | DONE | nav `messages` |
| 8.5 | 11.13e | Ribbon ← `incident` + Recording binary | DONE | Settings «Гэпы в работе» |
| 8.6 | 11.13f | Manual resolve + J8 crash ingest | DONE | POST resolve/backfill-open |
| 8.7 | 11.13g | Soft-delete / restore | DONE | V030; `738b384`…`cc634c2` |
| 8.8 | Crash | Host outage T+C (D1–D8) | DONE | `47fb58e`…`62453e0` + D6+LS |
| I2 | — | Fan-out journal ↔ NC atoms | RESOLVED | [../phase11/issue.md](../phase11/issue.md) I2 |
| 8.9 | Design | Schedule-as-projection | DESIGN AGREED | канон |
| 8.10 | P2 | Void mask Connection | DONE | `showScheduleMask$` |
| 8.11 | P1/WG | Cutter + Write Gaps | DONE | phase 7h |

## Лог (сводка; детали в бывшем phase11 report)

| Дата | Действие | Результат |
| ---- | -------- | --------- |
| 2026-07-29 | Старт журнала; DESIGN AGREED; 11.13a–f | код + UI + ribbon |
| 2026-07-29 | I2 fan-out RESOLVED | единый шаг journal+NC |
| 2026-07-30 | Crash dispatch D1–D8 DONE | HostOutage + ApiTests |
| 2026-08-02 | Soft-delete V030 DONE | visibility ⊥ lifecycle |
| 2026-08-04 | Docs: home → **phase 8**; NC остаётся в phase 11 | roadmap Stage 1 |

Полный хронологический лог реализации — [../phase11/report.md](../phase11/report.md)
(строки 11.13 / Crash / soft-delete); не дублируем здесь.

## Итог

Журнал OHS + ribbon + soft-delete + crash fan-out — **готовы** для закрытия Stage 1 / phase 8.
Follow-up: schedule-projection switchover; вынос NC — Stage 2 / phase 11.
