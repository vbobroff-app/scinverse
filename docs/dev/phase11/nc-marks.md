# NC — маркеры ★ / ⊘ и фильтр «Выбор»

Связано: [dock-settings.md](dock-settings.md) (Группировать), [`features/nc/threads`](../../features/nc/threads/spec.md),
**soft-delete** [incident-soft-delete.md](incident-soft-delete.md).
Код: `packages/notification-center` — `ncMarks.ts`, `filterItems.ts`, `NotificationRow` /
`ThreadBlock`, фильтр «Выбор» в `DockFilters`.

Персист меток: `localStorage` ключ `nc.marks` → map `id → { isFavorite?, isLeft? }`.
Поле `isLeft` = ⊘ спам (имя сохранено для совместимости; в UI не «отложено»).
Сервер / V025 не хранит метки (v1).

Персист choices «Выбор» (в т.ч. `deleted`) — хост OHS `notificationDockStorage`
(`ohs:notificationDock`), вместе с остальными фильтрами дока.

Маркеры видны на **каждом** Entry (в т.ч. внутри Group/Incident) и на header Thread.
Legacy: метка на `thread.uid` по-прежнему учитывается при resolve Entry
(`resolveEntryMarks`); bulk header сбрасывает legacy-ключ.

---

## UI

| | ★ | ⊘ |
|---|---|---|
| Символ | ★ | ⊘ |
| Entry tip (off → on) | Отметить | В спам |
| Entry tip (on → off) | Снять | Показывать |
| Активный цвет | accent (синий) | danger (красный) |
| Header tip | bulk all Entry on/off | bulk all Entry on/off |

Фильтр «Выбор» (плашка в панели фильтров):

| id | Label | Default |
|----|-------|---------|
| `favorite` | ★ Избранные | off |
| `left` | ⊘ Спам | off (спам **скрыт**) |
| `deleted` | Удалённые | off (soft-deleted **скрыты**) |

★ / ⊘ по умолчанию **unchecked**. Спам и soft-deleted в ленте **скрыты**, пока не включены
соответствующие галки «Выбор».

---

## ★ Избранные

| | |
|---|---|
| Entry | toggle своей ★ |
| Header горит | **хотя бы один** Entry со ★ |
| Клик header | все Entry ★ on ↔ all off |

**Фильтр «★ Избранные»:**

- Группировать on (level 0): Single со ★; Thread, если header ★ горит (any).
- Группировать off: только Single со ★.

---

## ⊘ Спам

| | |
|---|---|
| Entry | toggle своего ⊘ |
| Header горит | **все** Entry с ⊘ |
| Клик header | все Entry ⊘ on ↔ all off |

**Фильтр «⊘ Спам»** — **include** (default hide, как «Удалённые»):

- Галка off (default): скрыть Single с ⊘; скрыть Thread, только если header ⊘ горит (all).
- Галка on: показать контейнеры со спамом в ленте.
- Группировать off: то же на уровне Single.

Unread: Entry с ⊘ не считается непрочитанным (не мигает); остальной стек — как обычно.

---

## Удалённые (`deleted`) — soft-delete journal

Ось видимости журнала (`incident.deleted_at`), **не** клиентская метка на Entry.
Канон: [incident-soft-delete.md](incident-soft-delete.md).

| | |
|---|---|
| Источник | `softDeletedCorrs$` (hydrate `GET /incidents?includeDeleted=true` + WS `incidentVisibilityChanged`) |
| Thread | `isSoftDeleted` → badge **deleted** (красный текст, muted фон, `1px` red border) вместо lifecycle |
| Атомы | остаются в hub/bus; клиент **скрывает** по corr |

**Фильтр «Удалённые»** — **include** (default hide):

- Галка off (default): скрыть Thread/Single, чей `correlationId` ∈ soft-deleted.
- Галка on: показать soft-deleted в ленте (с badge deleted).

Журнал (модалка / страница) — отдельная галка «Показывать удалённые»
(`ohs:incidentsJournal:showDeleted`); ribbon/гант soft-deleted **всегда скрывает**.

---

## ★ без ⊘ / обе галки on / `deleted`

**★ без ⊘:** избранный спам всё равно скрыт (default-hide спама побеждает).
**★ + ⊘:** видны избранные, в т.ч. помеченные спамом.
**`deleted` off:** soft-deleted скрыты даже если ★/⊘ on (ось видимости журнала побеждает).
**`deleted` on:** soft-deleted видны; ★/⊘ применяются как обычно.

Фильтры «Выбор» работают на **level 0** (контейнеры / Singles), стек внутри нити не
подрезают.
