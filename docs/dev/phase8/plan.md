# Phase 8. OHS Writers MVP — журнал инцидентов

Закрытие Stage 1 по **журналу инцидентов в OHS**: таблица `incident`, soft-delete, Connection-ribbon,
crash fan-out, to-be schedule-as-projection (design). Код выполнен ранее как **11.13a–g** + crash D1–D8;
домашняя документация перенесена сюда из phase 11 (2026-08-04).

**NC как продукт** (пакет, Thread UI, dock, V025 atoms, MFE) — **phase 11 / Stage 2**, не эта фаза.

**Статус:** `DONE` (код) · docs home. **Stage:** 1. **Зависимости:** phase 7j (продюсер break),
phase 7h (liveness / Write Gaps). Дизайн Stage 1 — [stage1/apply.md](../../stage1/apply.md).

## Канон (документы фазы)

| Документ | Содержание |
| -------- | ---------- |
| [incident-journal.md](incident-journal.md) | Журнал `incident`, API, ribbon, Recording binary |
| [incident-soft-delete.md](incident-soft-delete.md) | Ось видимости `deleted_at` / V030 |
| [crash-dispatch.md](crash-dispatch.md) | Host outage: T + C fan-out (D1–D8) |
| [schedule-projection.md](schedule-projection.md) | To-be: факты ⊥ mask/Cutter |
| [plan-schedule-projection.md](plan-schedule-projection.md) | План миграции as-is → to-be |
| [apply.md](apply.md) · [report.md](report.md) | Реализация и отчёт |

Смежно (не scope phase 8): Write Gaps на Ганте записи — [../phase7h/write-gaps.md](../phase7h/write-gaps.md);
NC Thread — [../phase11/plan.md](../phase11/plan.md).

## Область (in scope) — выполнено

| # | Бывш. id | Задача | Статус |
| - | -------- | ------ | ------ |
| 8.1 | 11.13a | `V028` + `IIncidentStore` | DONE |
| 8.2 | 11.13b | `JournalRegistrator` + wire Manager/Supervisor | DONE |
| 8.3 | 11.13c | REST `GET /api/incidents` (+ by connection) | DONE |
| 8.4 | 11.13d | UI «Журнал инцидентов» (Admin web) | DONE |
| 8.5 | 11.13e | Connection-ribbon ← `incident`; Recording binary merge | DONE |
| 8.6 | 11.13f | Manual resolve + crash ingest J8 | DONE |
| 8.7 | 11.13g | Soft-delete / restore (V030) | DONE |
| 8.8 | Crash | Host outage T+C fan-out D1–D8 | DONE |
| 8.9 | Design | Schedule-as-projection (канон + план миграции) | DESIGN AGREED |
| 8.10 | P2 | Schedule void mask на Connection-ribbon | DONE |
| 8.11 | P1/WG | ScheduleCutter + Write Gaps (Writers) | DONE (в 7h) |

## Вне области

- Вынос NC / atoms V025 в отдельный сервис — **phase 11 Stage 2**.
- Hard-delete / retention purge — later.
- Полный switchover «всегда Incident + Cutter везде» — follow-up по [plan-schedule-projection.md](plan-schedule-projection.md);
  Write Gaps уже режут hole ∩ desired (phase 7h).
- CI/CD — **phase 14** (Stage 4), не эта фаза.
- Keycloak — **phase 10**.

## Критерии приёмки (закрытие Stage 1 / phase 8)

1. Эпизоды break/crash пишутся в `incident` (fan-out с NC-атомами — I2).
2. Connection-ribbon и экран журнала читают `incident`; soft-delete скрывает с ribbon.
3. Crash: merge POST outage, T + C слои по [crash-dispatch.md](crash-dispatch.md).
4. `dotnet` / vitest зелёные; секреты в ленту/логи не попадают.

## Порядок (исторический)

8.1 → 8.2 → 8.3 → 8.4 → 8.5 → 8.6 → I2 fan-out → crash D1–D8 → 8.7 soft-delete.
Далее (не блокер закрытия docs): schedule-projection switchover; gate Stage 2.
