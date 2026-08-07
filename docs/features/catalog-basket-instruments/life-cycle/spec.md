# catalog-basket-instruments / life-cycle

**Часть фичи:** суточный Lifecycle и Refresh как **действия актуализации** каталога
(Available → static membership → Observed). Индекс — [`../main.md`](../main.md).

**As-is:** [apply.md](apply.md).  
Смежное: [`../catalog/spec.md`](../catalog/spec.md) §4 · [`wiki-readme/catalog.md`](../../../wiki-readme/catalog.md).

Статус: **IN CODE** (2026-08-07) — archive + immediate re-eval + post-dump sync +
NC (**Lifecycle** суточный / **Checkup** Refresh) + **durable гейт суток в БД**.
Dynamic ATM — после v1.

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
| **Суточный sweep** | Первый успешный **connect** в checkup-сутки | Периодическая актуализация (NC **Lifecycle**). Checkup-сутки: **≥ 04:00 МСК** (interim; later — OpenTime единого [`schedule/`](../schedule/spec.md)). Не старт Host, не календарная полночь. |
| **Refresh** | Оператор (`POST …/catalog/refresh`) | Force: invalidate dump-кэш + сброс OPT + тот же sweep (NC **Action** + **Checkup**; обходит гейт частоты) |
| **OK модалки** | Оператор | Eval **одного** basket → members → rebuild, если ☑ |
| **Галка набора** | Оператор | Только rebuild Observed (без re-eval rules) |
| **Start / Stop / Auto** | Оператор | Live system `recording` → rebuild Observed |

**Не** полный re-eval static на каждый обычный connect (после того как снимок уже есть).  
Connect может обновить Available в БД через dump; в registry мержим только Observed.

---

## 2.1 Гейт «раз в checkup-сутки» — только БД

Семантика **один суточный Lifecycle / один post-dump sync на checkup-сутки** не может жить
в памяти процесса Host: рестарт + Auto-connect снова увидит «пустой» гейт и повторит
весь конвейер (и NC Lifecycle).

**Канон:** якорь суток — durable checkpoint в PostgreSQL.

| Правило | Смысл |
|---------|--------|
| SoT гейта | таблица `ohs_runtime_state` (миграция `V033`) |
| Ключ checkup | `catalog.checkup.last_day` = `yyyy-MM-dd` checkup-суток |
| Ключ post-dump | `catalog.baskets.post_dump.last_day` = то же |
| Claim | при проходе гейта день **сразу** пишется в БД (до/вместе с работой) |
| Рестарт Host | читает ключ → Auto-connect **не** повторяет Lifecycle в те же сутки |
| Refresh (`force`) | NC Checkup; обходит гейт частоты; всё равно обновляет checkpoint |
| In-memory | только кэш внутри процесса после hydrate из БД — **не** источник истины |

Граница checkup-суток и гейт частоты — разные оси: cutover задаёт *какой* день сейчас;
БД отвечает, *уже ли этот день обработан*. После [`../schedule/`](../schedule/spec.md)
меняется только формула дня (`OpenTime`), не место хранения якоря.

As-is ключи / API — [apply.md §3.1](apply.md).

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

Гейт post-dump: 1×/checkup-сутки (тот же durable якорь в БД); после Refresh — `force`
(ещё раз, даже если утренний sync был).

Dynamic ATM (после v1): отдельный шаг — **не** в v1-конвейере.

---

## 4. NC

Основной признак `groupKind`: **периодичность → Lifecycle**,
**разовая health-проверка → Checkup** (например force Refresh, check-health).
Мутация каталога сама по себе ярлык не выбирает.

| Corr | `groupKind` | UI | Конвейер в стеке |
|------|-------------|-----|------------------|
| `…cache:` | action | **Action** | Refresh: кэш → wait dump → fresh |
| `…lifecycle:` | lifecycle | **Lifecycle** | Суточный connect-sweep: archive → expired → wait dump → новые |
| `…checkup:` | checkup | **Checkup** | Refresh / иная разовая актуализация |

Post-dump **не** отдельная нить — продолжает lifecycle/checkup после `wait_dump`.

Канон нитей: [`nc/threads`](../../nc/threads/spec.md).
Живая сессия dump не повторяет — Action говорит про **reconnect**.

---

## 5. Инварианты

1. `active=false` = архив по exp; ночной актуальный контракт остаётся Online.
2. Lifecycle **не** равен Stop записи сам по себе для не-архивных; для архивных — Stop/Auto off.
3. Static membership актуализируется на sweep / Refresh / OK модалки — не на каждый тик.
4. Observed-кэш после sweep всегда пересобирается из актуальных members + recording.
5. Intraday (`sec_status` / сессия) — **другая ось**, вне этой части.
6. **«Раз в checkup-сутки» обеспечивается только БД** (`ohs_runtime_state`), не памятью Host.
   Рестарт процесса не является новым checkup-днём.

---

## 6. Scope / out of scope

| В scope | Вне |
|---------|-----|
| Суточный + force sweep, post-dump sync, Refresh | Mid-day auto re-eval без dump/Refresh |
| Durable гейт суток в `ohs_runtime_state` | Распределённый lock между несколькими Host (один Host) |
| Re-eval static + rebuild Observed | Dynamic ATM refresh policy (T3) |
| NC Action + Lifecycle (сутки) + Checkup (Refresh) | Intraday / History archive UI |

---

## 7. Acceptance (часть)

1. Утро / Refresh: expired выпадают из `basket_member` и Observed; новые матчи glob появляются.
2. Обычный connect не гоняет полный re-eval static (кроме первого sweep дня).
3. Refresh при live-сессии: lifecycle-corr завершается; cache ждёт reconnect / dump.
4. Архивный инструмент нельзя Start / Auto on (`IsListedOnline`).
5. Рестарт Host + Auto-connect в те же checkup-сутки **не** открывает второй Lifecycle NC
   (якорь уже в `ohs_runtime_state`).
