# Feature: catalog-basket-instruments

**Area:** catalog · **Outcome:** baskets / Observed working set поверх Available.

Статус фичи: **DRAFT** (2026-08-06). Код baskets ещё не начат.

Фича режется на части: у каждой свой `spec` / `apply`. Общий канон слоёв
Available ⊥ Observed ⊥ Archive — в части **catalog**.

## Части

| Часть | Статус | Содержание |
|-------|--------|------------|
| [`catalog/`](catalog/spec.md) | DRAFT to-be · as-is DONE | Формирование Observed: наборы static/dynamic/system, модалка Available\|Match\|спека, кэш = Observed. [spec](catalog/spec.md) · [apply](catalog/apply.md) |
| `nc-integration/` | planned | NC вокруг baskets / Refresh eval — когда появится содержание |
| `schedule/` | planned | Расписание записи поверх Observed — когда появится содержание |

## Scope поставки (кратко)

| Инкремент | Состав |
|-----------|--------|
| **v1** | static + system `recording` + Observed-кэш/список + модалка |
| **v1.1+** | dynamic ATM, system `has_data`, … |

Подробности — в [`catalog/spec.md`](catalog/spec.md).

## Смежное

- As-is wiki: [`wiki-readme/catalog.md`](../../wiki-readme/catalog.md)
- Stages / gate'ы: [`plan.md`](../../plan.md)
- Долги Stage 1: [`stage1/abandoned.md`](../../stage1/abandoned.md)
