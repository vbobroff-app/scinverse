# Features — параллельный backlog

После Stage 1 MVP работаем по **фичам**, не по новым phase-папкам.

Фича = кросс-модульный outcome (UI → backend → NC …), без обязательного порядка.
Stages 2–4 остаются gate'ами в [`../plan.md`](../plan.md).

Хроника MVP (`phaseN`) — archive в [`../dev/`](../dev/main.md). Не копировать UI-дерево в папки.

## Правила

1. Имя: `<area>-<outcome>` (пример: `catalog-basket-instruments`).
2. Канон фичи — `main.md` (индекс частей) и/или `spec.md`; крупные фичи режут на подпапки (`catalog/`, …) со своими spec/apply.
3. Спека: Intent · MVP status (ссылки на phases) · Open · Model/API/UI · Invariants · Depends on · Out of scope.
4. Shared-канон (schedule-projection, journal, `instrument.active`) — в `architecture/` / `wiki-readme/`; фича ссылается, не дублирует.
5. Хвосты с id из Stage 1 (`7i.S1`, …) при переносе сохранять как трассировку → [`../stage1/abandoned.md`](../stage1/abandoned.md).
6. Индекс папки в docs — **`main.md`**, не `README.md`.

## Индекс

| Feature | Статус | Спека |
| ------- | ------ | ----- |
| catalog-basket-instruments | DRAFT | [main](catalog-basket-instruments/main.md) · [catalog/spec](catalog-basket-instruments/catalog/spec.md) |
