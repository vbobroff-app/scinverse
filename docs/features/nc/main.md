# Feature: nc

**Area:** notification-center · **Outcome:** модель ленты, нитей и меток NC.

Статус: **IN PROGRESS** (2026-08-07).  
Часть **threads** — канон вынесен из архива phase11; остальные части — по мере переноса.

## Части

| Часть | Статус | Содержание |
|-------|--------|------------|
| [`threads/`](threads/spec.md) | CANON · [spec](threads/spec.md) | Single / Entry / Thread · Incident\|Group · подтипы · проекция · UI |
| `marks/` | planned | ★ / ⊘, фильтр «Выбор», soft-delete видимости |
| `journal/` | planned | серверный журнал инцидентов (OHS `incident`) |
| `persistence/` | planned | атомы `notification`, hydrate, retention |

## Смежное

- Пакет: `packages/notification-center`
- Потребители: OHS Host / web; каталог — [`../catalog-basket-instruments/life-cycle/`](../catalog-basket-instruments/life-cycle/spec.md)
