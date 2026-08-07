# catalog-basket-instruments / life-cycle

**Часть фичи:** суточный Lifecycle и Refresh как **действия актуализации** каталога
(Available → static membership → Observed). Индекс — [`../main.md`](../main.md).

**As-is:** [apply.md](apply.md).  
Смежное: [`../catalog/spec.md`](../catalog/spec.md) §4 · [`wiki-readme/catalog.md`](../../../wiki-readme/catalog.md).

Статус: **IN CODE** (2026-08-07) — archive + immediate re-eval + post-dump sync +
NC checkup/lifecycle baskets. Dynamic ATM — после v1.

---

## 1. Зачем

Ось lifecycle отвечает на вопрос: **контракт ещё актуален по дате экспирации?**  
Это не intraday («торгуется сейчас») и не формирование набора в модалке.

После появления baskets Lifecycle / Refresh — не только `active=false` в БД, а полный
конвейер актуализации working set:

```text
Available (active)  →  re-eval static  →  basket_member  →  Observed-кэш
         ↑ archive expired
```

Без этого в Observed остаются просроченные members, а новые тикеры месяца не появляются,
пока оператор не откроет модалку и не нажмёт OK.

---

## 2. Действия (канон)

| Действие | Кто | Смысл |
|----------|-----|--------|
| **Суточный sweep** | Первый успешный **connect** в checkup-сутки | Checkup при связи с data-сервером. Checkup-сутки: **≥ 06:00 МСК** (interim; later — OpenTime единого [`schedule/`](../schedule/spec.md)). Не старт Host, не календарная полночь. |
| **Refresh** | Оператор (`POST …/catalog/refresh`) | Force: invalidate dump-кэш + сброс OPT-окон + тот же sweep |
| **OK модалки** | Оператор | Eval **одного** basket → members → rebuild, если ☑ |
| **Галка набора** | Оператор | Только rebuild Observed (без re-eval rules) |
| **Start / Stop / Auto** | Оператор | Live system `recording` → rebuild Observed |

**Не** полный re-eval static на каждый обычный connect (после того как снимок уже есть).  
Connect может обновить Available в БД через dump; в registry мержим только Observed.

---

## 3. Конвейер (sweep + post-dump)

### 3.1 Sweep (суточный / force Refresh)

1. **Archive** — `expiration < today МСК` → `instrument.active = false` (строки не удаляем).
2. **Evict** — выкинуть архивные id из in-memory registry.
3. **Recording side-effects** — Auto off + Stop открытой записи (best-effort) для архивных.
4. **Re-eval static + rebuild Observed** — сразу снять expired из `basket_member`.
5. **Invalidate dump** (суточный гейт) — разрешить persist следующего `<securities>`.

### 3.2 Post-dump basket sync

После того как Available успокоился (idle ~3 с после miss-flush / PersistQueue):

6. **Re-eval static снова** — дописать новых матчей из свежего Available.
7. **Rebuild Observed**.

Гейт post-dump: 1×/день МСК; после Refresh — `force` (ещё раз, даже если утренний sync был).

Dynamic ATM (после v1): отдельный шаг — **не** в v1-конвейере.

---

## 4. NC

| Corr | `groupKind` | UI | Конвейер в стеке |
|------|-------------|-----|------------------|
| `…cache:` | action | **Action** | Refresh: кэш → wait dump → fresh |
| `…lifecycle:` | lifecycle | **Lifecycle** | Refresh: archive → убрать expired → wait dump → **новые в наборы** → done |
| `…checkup:` | checkup | **Checkup** | Суточный: тот же конвейер актуальности |

Post-dump **не** отдельная нить — продолжает lifecycle/checkup после `wait_dump`.

Канон нитей: [`phase11/to-threads`](../../../dev/phase11/to-threads.md).
Живая сессия dump не повторяет — Action говорит про **reconnect**.

---

## 5. Инварианты

1. `active=false` = архив по exp; ночной актуальный контракт остаётся Online.
2. Lifecycle **не** равен Stop записи сам по себе для не-архивных; для архивных — Stop/Auto off.
3. Static membership актуализируется на sweep / Refresh / OK модалки — не на каждый тик.
4. Observed-кэш после sweep всегда пересобирается из актуальных members + recording.
5. Intraday (`sec_status` / сессия) — **другая ось**, вне этой части.

---

## 6. Scope / out of scope

| В scope | Вне |
|---------|-----|
| Суточный + force sweep, post-dump sync, Refresh | Mid-day auto re-eval без dump/Refresh |
| Re-eval static + rebuild Observed | Dynamic ATM refresh policy (T3) |
| NC Action / Lifecycle / Checkup | Intraday / History archive UI |

---

## 7. Acceptance (часть)

1. Утро / Refresh: expired выпадают из `basket_member` и Observed; новые матчи glob появляются.
2. Обычный connect не гоняет полный re-eval static (кроме первого sweep дня).
3. Refresh при live-сессии: lifecycle-corr завершается; cache ждёт reconnect / dump.
4. Архивный инструмент нельзя Start / Auto on (`IsListedOnline`).
