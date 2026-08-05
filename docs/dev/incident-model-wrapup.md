# Итог: модель инцидентов (мультиклиент · journal · link · NC)

> Сводка 2026-07-31. Не заменяет фазовые plan/report — якорь «где мы» после восстановления
> логики break/crash в новой модели.
>
> Канон: [`phase7j/incident.md`](phase7j/incident.md) · [`phase8/incident-journal.md`](phase8/incident-journal.md) ·
> [`wiki-readme/layers.md`](../wiki-readme/layers.md) · [`architecture/ohs-connectors-deploy.md`](../architecture/ohs-connectors-deploy.md).
> Stage 1 закрыт; хвосты — [`stage1/abandoned.md`](stage1/abandoned.md).

---

## 0. Что считаем восстановленным

Целевая модель **работает на живых приёмках** (Finam id=3, crash-inside-break, Adopt):

| Контур | Роль | Зависимость от NC |
|--------|------|-------------------|
| **`incident` (OHS journal)** | правда эпизода break/crash для ганта / API | нет |
| **`link_liveness` / capture** | геометрия дыр на Connection / recording | нет |
| **NC (атомы V025 + Thread UI)** | операторская лента, тот же fan-out; Thread → Incident (Crash\|Break) / Group (Lifecycle\|Action\|Checkup) | зеркало, не владелец · [phase11/to-threads.md](phase11/to-threads.md) |
| **мультиклиент** | crash via `/recovery/outage`, hold/recovered | клиент — наблюдатель |

OHS пишет journal + NC **на одном уровне** (IncidentFanOut); NC можно вынести (gate 11→12) без смены канона дыр.

Приёмки, которые закрывают регрессии:

- break / Degraded / ×5 / recovered — стек в одном `link:` corr  
- crash-inside-break + рестарт Host → **Adopt** (2026-07-31: stale-close только при Live)  
- `request_timeout=10` → ~8 с до Degraded на кабеле (зона DLL)  
- crash T/C dispatch (phase 11 D1–D8)

---

## 1. Что ещё не закрыто

### Блокеры / качество (имеет смысл до «итога»)

| # | Что | Где |
|---|-----|-----|
| **I12** | Pool exhausted / orphan FATAL — клиент **DONE** (1)(2); Host pool **DEFER** @100 | [phase7j/plan.md](phase7j/plan.md) §7j.22 · `6871a57` · `327c8fe` |
| **Приёмка на зелёном Finam** | Часто вне окна шлюза (±2 ч от сессии) — connect ×5 «в пустоту» | ops / расписание |

Wrap-up закоммичен: `6c7c36c` · race/markers `255cc93`. Handoff нового чата — [`docs/promt.md`](../promt.md) §8.

### Хвосты плана (не блокируют модель инцидентов)

| # | Что | Статус |
|---|-----|--------|
| **7j.15** | market profile (не только MOEX UI) | ПЛАН |
| **7j.16** | пагинация календаря по месяцам | ПЛАН |
| **J9 / J10** | per-connection grace / порог NC | ПЛАН |
| **I9 prod** | bind/health/proxy family за Vite | OPEN checklist |
| **openedAt = lastData** | уточнение левой границы break | to-be (согласовано, не код) |
| **finam-ws** | второй `IMarketConnector`, Linux, быстрый линк-детект | FUTURE ([ohs-connectors-deploy.md](../architecture/ohs-connectors-deploy.md)) |
| **Windows-агент DLL** | split prod Linux + агент | FUTURE (тот же док) |
| **Stage 2 (10+11)** | Keycloak + NC split / MFE | PLANNED |
| **7i хвосты** | sessions←SCD-2, pre-flight, … | [abandoned](stage1/abandoned.md) |
| **phase 14** | CI/CD на стенд | TODO |

Сознательно **не делаем** на эре TRANSAQ: QuickPath / NetworkChange / вторая DLL / фронтовый `offline`.

---

## 2. Итог → проверка → рефакторинг

### 2.1–2.3 — DONE (2026-07-31)

| Шаг | Результат |
|-----|-----------|
| Check | Diff сведён: Adopt Live-only, `request_timeout=10`, NC ok>warn, deploy docs |
| Refactor | `IsStaleOpenBreak` / `ResolveStaleOpenBreakAsync`; LinkDetect → `LogDebug` |
| Docs | phase7j plan/todo/issue/report · phase11 report · этот файл · promt §7 |
| I12 | Клиент: ribbon pipeline + close-all orphan health-ok; pool size не поднимали | `6871a57` · `327c8fe` |

Вне scope wrap-up / I12: 7j.15/16 UI, finam-ws, gate 11→12, Host `Max Pool Size` bump.

---

## 3. Критерий «можно закрывать веху инцидентов»

- [x] Journal ⊥ NC (fan-out)  
- [x] link_liveness / ribbon от journal  
- [x] Thread UI break/crash  
- [x] Crash dispatch Host  
- [x] Adopt crash-inside-break (живая приёмка 2026-07-31)  
- [x] Статусы в phase7j/11 report синхронизированы  
- [x] Рефактор Adopt + LinkDetect; wrap-up закоммичен  
- [x] I12 клиент mitigation (7j.22 шаги 1–2); Host pool — явный defer @100  

Инцидентный контур 7j+11 **стабилизирован по модели**. Дальше по приоритету: **7j.15–16** / gate 11→12 / finam-ws; Host pool — только если снова exhausted.
