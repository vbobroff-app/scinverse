# Features — параллельный backlog

После Stage 1 MVP работаем по **фичам**, не по новым phase-папкам.

Фича = кросс-модульный outcome (UI → backend → NC …), без обязательного порядка.
Stages 2–4 остаются gate'ами в [`../plan.md`](../plan.md).

Хроника MVP (`phaseN`) — archive в [`../dev/`](../dev/main.md). Не копировать UI-дерево в папки.

---

## Зачем фичи (а не «сначала вся область целиком»)

**Staging остаётся каркасом:** Stage 1 → 2 → 3 → 4 — крупные gate'ы (auth, split, WebGL…).
От них не отклоняемся.

**Внутри горизонта после MVP** поставка идёт **параллельными фичами**, каждая — сквозной
тонкий срез, а не слой «закончим все наборы → потом NC → потом schedule».

| Подход | Риск / эффект |
|--------|----------------|
| По фазам «сначала весь каталог baskets (static+dynamic+…) → потом NC» | Нет раннего масштаба; легко застрять на ширине; оператор долго без рабочего контура |
| По фичам: static baskets **сквозь** lifecycle + NC (+ стыки schedule) | Рабочий функционал рано; соседние фичи подтягиваются по мере нужды; dynamic — следующий инкремент той же фичи |

Пример уже на практике — [`catalog-basket-instruments`](catalog-basket-instruments/main.md):

- сделали **static** + Observed + модалку;
- протащили **life-cycle** (суточный sweep, post-dump) и **NC** (Lifecycle / Checkup / Action);
- **не ждали** dynamic ATM / `has_data` / полной спеки инструмента;
- получили usable контур записи по наборам, а DRAFT-части (`schedule`, `spec-instruments`) живут рядом.

Фичи **независимы по запуску** (можно вести несколько), но **не ломают staging**: не стартуем
Stage 3 «заодно», не подменяем Keycloak/split новыми phase-папками. Канон и apply — в
`features/`; `dev/phaseN` — архив хроники.

---

## Правила

1. Имя: `<area>-<outcome>` (пример: `catalog-basket-instruments`).
2. Канон фичи — `main.md` (индекс частей) и/или `spec.md`; крупные фичи режут на подпапки (`catalog/`, …) со своими spec/apply.
3. Спека: Intent · MVP status · Open · Model/API/UI · Invariants · Depends on · Out of scope.
4. Shared-канон (schedule-projection, journal, threads) — в `architecture/` / `wiki-readme/` /
   соседних `features/` (напр. [`nc/threads`](nc/threads/spec.md)); фича ссылается, не дублирует.
5. Хвосты с id из Stage 1 (`7i.S1`, …) при переносе сохранять как трассировку → [`../stage1/abandoned.md`](../stage1/abandoned.md).
6. Индекс папки в docs — **`main.md`**, не `README.md`.
7. Инкремент фичи = **сквозной vertical** (данные → Host → UI → NC при необходимости), не
   горизонтальный «весь слой домена». Ширину (dynamic, news, …) наращиваем следующими срезами.
8. Stages — gate'ы; features — параллельный backlog **внутри** текущего staging-горизонта.

## Индекс

| Feature | Статус | Спека |
| ------- | ------ | ----- |
| nc | IN PROGRESS (threads CANON) | [main](nc/main.md) · [threads](nc/threads/spec.md) |
| catalog-basket-instruments | IN PROGRESS (C0–C3 + life-cycle DONE; schedule / spec-instruments DRAFT) | [main](catalog-basket-instruments/main.md) · [catalog](catalog-basket-instruments/catalog/spec.md) · [life-cycle](catalog-basket-instruments/life-cycle/spec.md) · [schedule](catalog-basket-instruments/schedule/spec.md) · [spec-instruments](catalog-basket-instruments/spec-instruments/spec.md) |
