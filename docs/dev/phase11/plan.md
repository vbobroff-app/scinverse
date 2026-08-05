# Phase 11. Notification Center + разделение сервисов

**NC как продукт** и **split** монолита: отдельные сервисы **OHS**, **Admin Front**, **Notification Center**.

База пакета (`@scinverse/notification-center`), Thread UI, dock, V025 atoms — уже реализованы в
монолите; эта фаза Stage 2 доводит NC до отдельного деплоя и связки MFE, без смешения с журналом
OHS (журнал — **[phase 8](../phase8/plan.md)** / Stage 1).

**Статус:** `PLANNED` (база NC DONE в монолите; вынос — впереди).
**Stage:** 2. **Зависимости:** phase 8 (журнал OHS стабилен); phase 10 (Keycloak) — в gate выноса.
Дизайн Stage 1 — [stage1/apply.md](../../stage1/apply.md); C4 — [`../../architecture/c4/arch.md`](../../architecture/c4/arch.md).
Детали реализации пакета — [apply.md](apply.md); статус базы — [report.md](report.md).

## Что осталось здесь (NC)

| Документ | Содержание |
| -------- | ---------- |
| [to-threads.md](to-threads.md) | Thread → Incident (Crash\|Break) / Group (Lifecycle\|Action\|Checkup) |
| [persistence.md](persistence.md) | V025 atoms `notification` |
| [dock-settings.md](dock-settings.md) | Опции дока |
| [nc-marks.md](nc-marks.md) | Маркеры ★/⊘ |
| [issue.md](issue.md) | Issues NC (+ I2 fan-out с журналом) |
| [apply.md](apply.md) · [report.md](report.md) | Реализация / отчёт базы NC |

**Перенесено в phase 8:** journal, soft-delete, crash-dispatch, schedule-projection
(stubs в этой папке → `../phase8/…`).

## Мотивация

События должны жить в **единой сквозной ленте** оператора (уровни, фильтры, Thread-контейнеры).
В монолите пакет уже встроен; to-be — отдельный сервис NC + MFE remote во все фронты, atoms SoT
в контуре NC, OHS только продюсер фактов (в т.ч. journal phase 8).

## Таксономия события (зафиксировано)

- **Уровень:** `info` · `warning` · `critical` · `error`.
- **Тип (sourceType):** `user` · `system` · `external`.

## Область Stage 2 (in scope)

### A. База NC в монолите (DONE — не переделывать)

- **11.1–11.7** Контракт, Hub/WS/REST, пакет, dock, фильтры, встраивание, тесты.
- **11.8–11.12** Thread model, проекция `items$`, UI контейнеры, hints, регрессия.
- Persistence V025 — [persistence.md](persistence.md).

### B. Вынос и split (TODO — фокус фазы)

- **11.S1** Границы сервисов: OHS (data/control + journal), Admin Front (shell), NC (лента + atoms).
- **11.S2** Отдельные репо/пакеты/деплои; контракты REST/WS стабильны для JWT (phase 10).
- **11.S3** NC как MFE remote; Admin Front — host; общая шина/контракт без копипасты.
- **11.S4** Перенос SoT atoms (`notification`) в контур NC (или dual-read → cutover) — gate с phase 8 journal остаётся в OHS.
- **11.S5** Приёмка: три сервиса поднимаются раздельно; Keycloak на API/UI; нет секретов в ленте.

## Вне области

- Журнал `incident` / soft-delete / crash OHS / schedule-projection канон — **phase 8**.
- WebGL Ганта — **phase 12** (после этого gate).
- CI/CD на стенд — **phase 14**.
- Пуш email/telegram, тонкая RBAC-маршрутизация событий — later (грубо — с phase 10).

## Критерии приёмки (Stage 2)

1. NC деплоится отдельно; Admin Front подключает MFE/пакет без монолитного Host как UI-shell.
2. OHS остаётся источником journal + control; публикует события в NC по контракту.
3. Keycloak (phase 10) валидирует API/WS/UI на всех трёх контурах.
4. База Thread/dock не регрессирует (`tsc` / vitest / `dotnet`).

## Порядок

1. Стабилизировать контракты при Keycloak (phase 10 ∥ или сразу перед split).
2. Вынести Admin Front → NC remote → atoms cutover.
3. Gate → Stage 3 / phase 12.
