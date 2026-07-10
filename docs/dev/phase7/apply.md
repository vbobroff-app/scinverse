# Phase 7. Особенности реализации (админ-фронт)

Конкретные решения по фронту. План — в [plan.md](plan.md).

## 1. Размещение и стек

- Каталог: `services/online-history-server/web` (SPA рядом с OHS, см. корневой `../apply.md`).
- Менеджер пакетов **pnpm**; сборка/дев — **Vite**; тесты — **Vitest**; React 19 + TS 5.x.
- Линт/формат: ESLint 9 (flat config) + typescript-eslint, Prettier. Иконки — `@iconify/react`.
- Зависимости рантайма: `react`, `react-dom`, `rxjs`, `@iconify/react`. Без UI-библиотек (plain + CSS).

## 2. Архитектура: ядро (RxJS) + React-слой

Приём из `scrider-editor` (framework-agnostic core + тонкий React). Каталоги в `src/`:

```
core/                 # без React — тестируется в vitest без DOM
  types.ts            # DTO зеркалом IOhsApi (camelCase)
  api.ts              # OhsApi: методы REST через rxjs/ajax → Observable
  live.ts             # LiveStream: rxjs/webSocket на /ws, retry/reconnect, поток LiveEvent
  stores/
    connections.ts    # connections$ (BehaviorSubject) + refresh() + мёрж connectionStatusChanged
    recordings.ts     # recordings$ + start/stop + мёрж recordingStarted/Stopped
    coverage.ts       # coverage$ (по окну) + мёрж coverageExtended (рост колбасок)
ui/
  hooks/useObservable.ts
  components/ (Button, StatusDot, CoverageGantt, GanttRow, Bar, …)
  pages/ (ProviderCard, OverviewBoard, ExchangesNav)
styles/ (variables.css, global.css)
App.tsx  main.tsx
```

- **REST:** `rxjs/ajax` `ajax.getJSON<T>` / `ajax` для POST/DELETE. Базовый префикс `/api` (Vite proxy).
- **WS:** `rxjs/webSocket` `webSocket<LiveEvent>('/ws')` с `retryWhen`/`retry({delay})` для reconnect;
  события мультиплексируются в сторы. Один общий сокет на приложение.
- **Сторы:** `BehaviorSubject` с текущим состоянием; методы (`refresh`, `start`, `stop`, `connect`)
  дергают `OhsApi` и обновляют subject; параллельно live-события инкрементально правят состояние
  (напр. `coverageExtended` увеличивает `to`/`tradeCount` нужной колбаски без перезапроса).

## 3. React-слой

- `useObservable(obs$, initial)` — подписка на `Observable`/`BehaviorSubject`, отписка на unmount.
- Компоненты «тупые»: получают данные из хука, шлют команды в сторы. Никакого fetch в компонентах.

## 4. Палитра и темы (из scrider)

`styles/variables.css` — переменные scrider 1:1: light в `:root`, dark в `[data-theme="dark"]`.
Ключевое (dark, по умолчанию): `--color-bg:#1a1b1e`, `--color-bg-panel:#25262b`,
`--color-bg-hover:#373a40`, `--color-text:#e9ecef`, `--color-border:#373a40`,
`--color-accent:#4dabf7`, `--color-accent-hover:#74c0fc`, `--color-success:#198754`,
`--color-error:#dc3545`; spacing/radius/шрифты (Segoe UI / Cascadia Code) — тоже оттуда.
`ThemeToggle` переключает атрибут `data-theme` на `<html>` (dark по умолчанию).

Цвета источников (колбаски) — карта `source_id → цвет`: `transaq #4dabf7`, `qscalp #b197fc`,
`synthetic #63e6be`, `plaza2 #ffa94d` (акцентная гамма Mantine-типа). Дыры — CSS repeating-gradient.

## 5. Гант покрытия (div-модель)

- Контейнер строки = окно `[from,to]`; сегмент — `position:absolute`,
  `left=(from-min)/(max-min)`, `width=(end-from)/(max-min)` в %.
- Открытая сессия (`ended_at=null`) — класс `.live`, правый край = now; по `coverageExtended`
  двигаем правый край и обновляем счётчик.
- Дыры — оверлей-div поверх колбаски по `gap.from/to`.
- Ось времени — заголовок с тиками; вертикальная сетка — `linear-gradient` фоном (0 узлов).
- Производительность: рендерим только сегменты, пересекающие окно; строки виртуализуем при росте.

## 6. Дев-запуск и proxy

- `vite.config.ts`: `server.proxy` — `/api` и `/ws` (ws:true) → `http://localhost:5080` (OHS Host).
- Скрипты `package.json`: `dev`, `build`, `preview`, `test`, `lint`, `format`, `typecheck`.
- README: поднять OHS (`dotnet run` в Host) + `pnpm i && pnpm dev`.

## 6a. Каталог инструментов: пагинация + фильтры (итерация 2)

Каталог большой (тысячи инструментов) — не тянем целиком на клиент.

- **API:** `GET /api/instruments?q=&board=&secType=&onlyRecording=&limit=&offset=` →
  `InstrumentPageDto { items: InstrumentDto[], total, limit, offset }`. `InstrumentDto` расширен
  `secType/name/active/recording`.
- **SQL (Dapper):** `WHERE` со склейкой опциональных условий (`@x IS NULL OR …`), `ILIKE` по
  ticker/name, «запущенные» через `EXISTS(coverage_segment … ended_at IS NULL)`; `total` —
  `COUNT(*) OVER()` в том же запросе (fallback отдельным `COUNT` для пустой страницы);
  `ORDER BY ticker, board_id` (детерминизм для offset), `LIMIT/OFFSET`. Порт —
  `IInstrumentStore.QueryAsync(InstrumentQuery)`; read-model `InstrumentCatalogItem/Page`.
- **Пагинация:** offset+total (каталог почти статичен; keyset отложен). Клиент — infinite scroll с
  append (`offset = загружено`).
- **Фронт-стор:** `instrumentQuery$/instruments$/instrumentsTotal$/instrumentsLoading$`,
  `setInstrumentFilter` (сброс offset + перезагрузка), `loadMoreInstruments` (append, с гардами
  loading/`loaded>=total`).

## 6b. Производительность Ганта: тик без ре-рендеров + виртуализация

- **Тик → CSS-переменная.** «Ползущий» правый край открытой колбаски и now-линия управляются
  `--now-pct` (ставится на скролл-контейнере): открытый бар — `right: calc(100% - var(--now-pct)*1%)`,
  now-линия — `left: calc(var(--now-pct)*1%)`. Секундный тик меняет только переменную на контейнере;
  строки не ре-рендерятся. Строки — `React.memo`; группировка сегментов и колбэки Start/Stop
  стабилизированы (`useMemo`/`useCallback`), поэтому память не «протекает» пропсами.
- **Виртуализация:** `useVirtualRows` (фикс. высота строки + overscan, спейсеры сверху/снизу),
  рендерим только видимое окно; при подходе к низу — `onNearEnd → loadMoreInstruments`.
- **Единая таблица** (`InstrumentTable`): инструмент + счётчик + Start/Stop + дорожка покрытия
  в одной строке (вместо отдельных списка и Ганта). Ось времени — `TimeAxis` в шапке над колонкой
  дорожки; дорожка — `CoverageTrack` (мемо). `CoverageGantt` удалён.

## 7. Тесты (vitest)

- Ядро без DOM: мёрж `coverageExtended` в `coverage$` (рост колбаски), `connectionStatusChanged`
  в `connections$`, маппинг REST-ответа в типы. Live-поток мокаем `Subject<LiveEvent>`.
- Компоненты — точечно (`@testing-library/react`) для критичных (Гант-позиционирование), по мере надобности.
