# NC — маркеры ★ / ⊘ и фильтр «Выбор»

Связано: [dock-settings.md](dock-settings.md) (Группировать), [to-threads.md](to-threads.md).
Код: `packages/notification-center` — `ncMarks.ts`, `filterItems.ts`, `NotificationRow` /
`ThreadBlock`, фильтр «Выбор» в `DockFilters`.

Персист: `localStorage` ключ `nc.marks` → map `id → { isFavorite?, isLeft? }`.
Поле `isLeft` = ⊘ спам (имя сохранено для совместимости; в UI не «отложено»).
Сервер / V025 не хранит метки (v1).

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

| id | Label |
|----|-------|
| `favorite` | ★ Избранные |
| `left` | ⊘ Спам |

★ / ⊘ по умолчанию **unchecked**. Спам в ленте **скрыт** (как soft-deleted), пока не включён «⊘ Спам».

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

## ★ без ⊘ / обе галки on

**★ без ⊘:** избранный спам всё равно скрыт (default-hide спама побеждает).
**★ + ⊘:** видны избранные, в т.ч. помеченные спамом.

Фильтры «Выбор» работают на **level 0** (контейнеры / Singles), стек внутри нити не
подрезают.
