# Scinverse — handoff (новый чат)

Читать первым. Дальше — по ссылкам, не тащить весь archive в контекст.

**Отвечать по-русски**, если пользователь пишет по-русски.  
Коммит — **только по явной просьбе**. PowerShell: `;` не `&&`; commit-msg → файл + `git commit -F`.

---

## Проект

Платформа биржевых данных/торговли. Hot path — C#/.NET; cold — Python + Timescale/Kafka.  
В фокусе **OHS**: TRANSAQ → нормализация → Timescale → REST/WS + admin UI.

Подробнее: [`concept.md`](concept.md) · [`ohs.md`](ohs.md).

---

## Куда смотреть

| Нужно | Файл |
| ----- | ---- |
| Stages / gate'ы | [`plan.md`](plan.md) |
| Параллельный backlog | [`features/main.md`](features/main.md) |
| Долги Stage 1 | [`stage1/abandoned.md`](stage1/abandoned.md) |
| Индекс Stage 1 | [`stage1/main.md`](stage1/main.md) |
| Archive фаз MVP | [`dev/main.md`](dev/main.md) (`phase*` — не двигать) |
| Wiki оператора | [`wiki-readme/`](wiki-readme/README.md) |
| Архитектура | [`architecture/`](architecture/db-design.md) |

Индекс папки в docs — **`main.md`** (не `README.md`).  
Фича = `<area>-<outcome>`, кросс-модульно; не копировать UI-дерево.

---

## Сейчас

- **Stage 1 DONE** (phase 4–8). OPT/Refresh/каталог — DONE, не Stage 2.
- Рабочий контур после MVP — **Features**, не новые phase-папки.
- Пилот: [`features/catalog-basket-instruments/`](features/catalog-basket-instruments/main.md)
  (C0–C3 DONE) · [`catalog/`](features/catalog-basket-instruments/catalog/spec.md) ·
  [`life-cycle/`](features/catalog-basket-instruments/life-cycle/spec.md).
- Stage 2–4 — gate'ы (Keycloak → NC split → WebGL); не стартовать «заодно».

**Next:** ручной прогон life-cycle / другая фича / dynamic — спросить у пользователя.

---

## Запуск (кратко)

```powershell
dotnet run --project db/Scinverse.Db.Migrator   # V032+ (baskets); иначе возможны 500
# Host: services/.../Scinverse.Ohs.Host  (перед rebuild — остановить, lock DLL)
# Web:  services/online-history-server/web → pnpm dev --port 5174
```

Lint: `tsc --noEmit` (0), eslint 0 errors; бэк — `dotnet build` Host.  
Стиль коммитов: `feat(ohs-…):` / `feat(nc):` / `docs:`.

Критичные инварианты (не ломать) — в [`stage1/incident-model-wrapup.md`](stage1/incident-model-wrapup.md),  
[`wiki-readme/catalog.md`](wiki-readme/catalog.md), [`dev/phase8/`](dev/phase8/plan.md); не дублировать здесь.
