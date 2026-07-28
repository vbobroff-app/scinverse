# NC — маркеры ★ / ⊘ и фильтр «Выбор»

Связано: [dock-settings.md](dock-settings.md) (Группировать), [to-threads.md](to-threads.md).
Персист: `localStorage` `nc.marks[id]` → `{ isFavorite?, isLeft? }` (`isLeft` = ⊘ спам).

Маркеры видны на **каждом** Entry (в т.ч. внутри Group/Incident) и на header Thread.

---

## ★ Избранные

| | |
|---|---|
| Entry | toggle своей ★ |
| Header горит | **хотя бы один** Entry со ★ |
| Клик header | все Entry ★ on ↔ all off |

**Фильтр «★ Избранные»** (default unchecked = не фильтруем):

- Группировать on (level 0): Single со ★; Thread, если header ★ горит (any).
- Группировать off: только Single со ★.

---

## ⊘ Скрывать спам

| | |
|---|---|
| Entry | toggle своего ⊘ |
| Header горит | **все** Entry с ⊘ |
| Клик header | все Entry ⊘ on ↔ all off |

**Фильтр «⊘ Скрывать спам»** (default unchecked = ничего не скрываем) — **обратная** логика:

- Группировать on: скрыть Single с ⊘; скрыть Thread, только если header ⊘ горит (all).
  Иначе нить целиком видна (в т.ч. отдельные ⊘ внутри).
- Группировать off: скрыть Single с ⊘.

---

## Обе галки Выбор on

**⊘ побеждает ★:** уведомление / контейнер, попадающий под правило спама, скрыт,
даже если отмечен ★.
