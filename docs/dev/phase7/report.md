# Phase 7. Отчёт о выполнении

Актуальный статус фазы 7. Обновляется по мере выполнения задач из [plan.md](plan.md).

**Текущий статус:** `IN PROGRESS` — вертикальный срез (уровень 3: карточка провайдера) готов;
build/тесты/линт зелёные. Далее — E2E против живого хоста + уровни 2/1.
**Обновлено:** 2026-07-09.

## Статус задач

| #    | Задача | Статус | Комментарий |
| ---- | ------ | ------ | ----------- |
| 7.1  | Скаффолд Vite+React+TS (pnpm) | DONE | vite 8, react 19, ts 5.9, vitest 4, eslint 9 flat |
| 7.2  | Палитра scrider + `ThemeToggle` | DONE | `variables.css`/`global.css`, dark-first, синий акцент |
| 7.3  | `core/`: types, `OhsApi`, `LiveStream` | DONE | `rxjs/ajax` + `rxjs/webSocket` (retry/share) |
| 7.4  | `core/OhsStore` + мёрж live-событий | DONE | connections/recordings/coverage$ + onLive |
| 7.5  | `useObservable`/`useBehavior` + каркас `App` | DONE | контекст стора, автo-выбор провайдера |
| 7.6  | Экран уровня 3 (карточка провайдера) | DONE | connect/индикатор, инструменты, Start/Stop |
| 7.7  | `CoverageGantt` (div-модель) | DONE | колбаски/дыры/ось/now-линия, «ползёт» по WS+тик |
| 7.8  | Vite dev-proxy + README | DONE | proxy `/api`+`/ws`→:5080, README запуска |
| 7.9  | Тесты ядра (vitest) | DONE | 2 теста: мёрж coverageExtended / connectionStatusChanged |
| 7.10 | Документация | DONE | plan/apply/report обновлены |

## Результаты проверки

- `pnpm build` (tsc -b + vite) — 0 ошибок; бандл ~233 kB (gzip 73 kB).
- `pnpm test` (vitest) — 2/2 зелёные; `pnpm lint` (eslint flat) — чисто.
- E2E против живого хоста (DB+OHS+`pnpm dev`) — проверяется отдельно (см. README).

## Осталось на следующие итерации фазы

- Уровень 2 — обзорная доска (Гант по всем провайдерам, sub-дорожки при нахлёсте источников).
- Уровень 1 — навигация по биржам (MOEX активна, прочие — заглушки).
- Управление подключениями из UI (create/edit, ввод credentials), выбор окна Ганта (зум/пан).

## Итерация 2 — каталог: пагинация, фильтры, производительность

Причина: реальный каталог инструментов — тысячи строк; фронт тормозил из-за (а) отдачи всего
справочника и (б) посекундного ре-рендера всех строк Ганта (`useNow`).

Бэк:
- `GET /api/instruments?q=&board=&secType=&onlyRecording=&limit=&offset=` → `InstrumentPageDto
  { items, total, limit, offset }`. SQL: склейка `WHERE`, `COUNT(*) OVER()` для total одним
  запросом (fallback-`COUNT` для пустой страницы), `ORDER BY ticker, board_id`, `LIMIT/OFFSET`.
  Фильтр «запущенные» — `EXISTS (coverage_segment … ended_at IS NULL)`.
- `InstrumentDto` расширен: `secType`, `name`, `active`, `recording`. Новый порт-метод
  `IInstrumentStore.QueryAsync(InstrumentQuery)`; read-model `InstrumentCatalogItem/Page`.
  Миграции не потребовались (все поля уже в `instrument`).

Фронт:
- Стор: пагинированный каталог (`instrumentQuery$/instruments$/instrumentsTotal$/instrumentsLoading$`),
  `setInstrumentFilter` (сброс offset) + `loadMoreInstruments` (append).
- **Тик Ганта переведён на CSS-переменную `--now-pct`** (ставится на скролл-контейнере): «ползущий»
  край открытой сессии и now-линия двигаются чистым CSS → строки не ре-рендерятся по тику. Строки
  мемоизированы (`React.memo`), группировки/колбэки стабилизированы (`useMemo`/`useCallback`).
- **Виртуализация** строк (`useVirtualRows`, фикс.высота + overscan) + infinite scroll (`onNearEnd` →
  `loadMoreInstruments`). Панель фильтров (`FilterBar`): debounced-поиск, селект типа, «только
  запущенные», счётчик найденного. Единая таблица инструмент+колбаска вместо двух списков.

Проверки: бэк — `dotnet build` 0/0, `dotnet test` **32** (20+8+4, добавлен тест поиска/пагинации);
фронт — `pnpm build`/`test`(2)/`lint` зелёные.

## Лог выполнения

| Дата | Действие | Результат |
| ---- | -------- | --------- |
| 2026-07-09 | Созданы план/спецификации фазы 7 (IA, стек, core/RxJS, палитра из scrider) | Документы готовы |
| 2026-07-09 | Скаффолд + палитра + `core` (RxJS) + карточка провайдера (ур.3) + Гант + тесты | build/тесты/линт зелёные |
| 2026-07-09 | Каталог: бэк-пагинация+фильтры (`InstrumentPageDto`), фронт — тик→CSS-var, виртуализация, фильтры | бэк 32 теста, фронт build/тесты/линт зелёные |
| 2026-07-09 | UI-разделение: пикер-плашки (тикер+Старт, без колбаски/сделок, disabled по `active`/connected) + отдельная панель «Идёт запись» с колбасками | фронт build/тесты/линт зелёные |

## Пауза на phase6c (иерархия инструментов)

Древовидный вид каталога (`base → series → strikes`) упёрся в отсутствие данных группировки:
таблица `derivative` пуста, парсер не извлекает `underlying/expiration/strike`. Сложности
зафиксированы в **[issue.md](issue.md)** и решаются бэкенд-фазой **[phase6c](../phase6c/plan.md)**.
После неё — возврат в phase7: переключатель «Список ↔ Дерево» + компонент дерева.

## Следующий шаг

Реализовать [phase6c](../phase6c/plan.md) (backend), затем вернуться: дерево на фронте, E2E против
живого хоста, обзорная доска (уровень 2) и навигация по биржам (уровень 1).
