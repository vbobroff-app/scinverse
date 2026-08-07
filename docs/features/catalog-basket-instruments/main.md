# Feature: catalog-basket-instruments

**Area:** catalog · **Outcome:** baskets / Observed working set поверх Available.

Статус фичи: **IN PROGRESS** (2026-08-07).  
C0–C3 DONE · life-cycle DONE (checkup с 04:00 МСК; гейт суток в `ohs_runtime_state`) · schedule — DRAFT.

Фича режется на части: у каждой свой `spec` / `apply`. Общий канон слоёв
Available ⊥ Observed ⊥ Archive — в части **catalog**.

## Части

| Часть | Статус | Содержание |
|-------|--------|------------|
| [`catalog/`](catalog/spec.md) | v1 C0–C3 DONE · [spec](catalog/spec.md) · [apply](catalog/apply.md) · [plan](catalog/plan.md) | Observed: static/system baskets, модалка Available\|Match\|спека, кэш = Observed |
| [`life-cycle/`](life-cycle/spec.md) | DONE · [spec](life-cycle/spec.md) · [apply](life-cycle/apply.md) | Суточный sweep на первом connect checkup-суток (≥04:00 МСК); гейт «раз в сутки» только в БД (`ohs_runtime_state`); post-dump; NC |
| [`schedule/`](schedule/spec.md) | DRAFT · [spec](schedule/spec.md) | Единое расписание: Auto connection = Auto writing; as-is connection + calendar; история — отдельно |
| `nc-integration/` | planned | NC вокруг baskets / richer emit |

## Scope поставки (кратко)

| Инкремент | Состав |
|-----------|--------|
| **v1** | static + system `recording` + Observed + модалка + Lifecycle checkup |
| **v1.1+** | unified schedule, dynamic ATM, `has_data`, … |

## Смежное

- As-is wiki: [`wiki-readme/catalog.md`](../../wiki-readme/catalog.md)
- Stages / gate'ы: [`plan.md`](../../plan.md)
- Долги Stage 1: [`stage1/abandoned.md`](../../stage1/abandoned.md)
