# Phase 7. Админ-фронт (React + Vite + TS) — план

Детальный план фазы 7. Дизайн Stage 1 — в [../apply.md](../apply.md); особенности реализации фазы —
в [apply.md](apply.md); статус — в [report.md](report.md).

## Цель

Веб-админка OHS (внутренний ops-инструмент) для управления записью и наблюдения покрытия:
пользователь выбирает биржу → провайдера → коннектится → на вкладке провайдера видит инструменты,
жмёт Start/Stop, колбаски покрытия «ползут» в реальном времени. Работаем против **живого** OHS API
(REST `/api/*` + WebSocket `/ws`), без моков.

## Предпосылки (готово в 6a/6b)

- REST-контракт `IOhsApi`: instruments, sources, coverage(+gaps), recordings (start/stop),
  connections (connect/disconnect/test/credentials).
- WebSocket `/ws`: `recordingStarted/Stopped`, `coverageExtended`, `connectionStatusChanged`.
- `SyntheticLiveConnector` — «живые» колбаски для демо без реального TRANSAQ.

## Информационная архитектура (3 уровня)

1. **Биржи** — MOEX активна; CME/Binance и пр. — заглушки (disabled). Пока статическая навигация
   (каталог-эндпоинта бирж нет).
2. **Провайдеры биржи + обзорная доска** — список подключений (`connector_connection`) с connect и
   индикатором статуса; рядом обзорный Гант по всем провайдерам (колбаски цветом по источнику).
3. **Карточка провайдера** — Гант инструментов этого провайдера + статусы записи, Start/Stop,
   одна колбаска на инструмент в рамках сессии.

Порядок реализации: сначала **уровень 3** (карточка провайдера), затем уровень 2 (обзор), затем
уровень 1 (навигация по биржам).

## Стек и архитектура

- React 19 + TypeScript + hooks, **Vite** (dev/build), **Vitest** (тесты), **pnpm**.
- ESLint 9 flat + typescript-eslint, Prettier + husky/lint-staged, `@iconify/react`.
- **RxJS для REST и WS.** Приём из `scrider-editor`: framework-agnostic ядро + тонкий React-слой.
  - `core/` (без React): `OhsApi` (REST через `rxjs/ajax`), `LiveStream` (`rxjs/webSocket`,
    авто-reconnect), доменные сторы (`BehaviorSubject`: connections$/recordings$/coverage$),
    в которые мёржатся live-события.
  - `ui/`: хук `useObservable(obs$)`; компоненты подписываются на сторы, логика — в ядре (тестируется
    без DOM).

## Дизайн

Палитра переносится из `scrider-editor` (CSS-переменные, dark-first, синий акцент `#4dabf7`),
без зависимости от UI-библиотеки («plain» + CSS-модули). Тема переключается `[data-theme]`.
Цвет колбаски = источник (`source_id`); дыры — штриховка.

## Задачи

| #    | Задача | Статус |
| ---- | ------ | ------ |
| 7.1  | Скаффолд Vite+React+TS (pnpm), tsconfig/eslint/prettier/vitest | TODO |
| 7.2  | Палитра scrider (`variables.css`/`global.css`), `ThemeToggle`, dark-first | TODO |
| 7.3  | `core/`: `types.ts`, `OhsApi` (ajax), `LiveStream` (webSocket + reconnect) | TODO |
| 7.4  | `core/stores`: connections$/recordings$/coverage$ + мёрж live-событий | TODO |
| 7.5  | `ui/hooks/useObservable`, каркас `App` + навигация (биржа→провайдер) | TODO |
| 7.6  | Экран уровня 3 (карточка провайдера): connect+индикатор, список инструментов, Start/Stop | TODO |
| 7.7  | `CoverageGantt` (div-модель): колбаска/дыры/ось времени, рост по WS | TODO |
| 7.8  | Vite dev-proxy на OHS (`/api`,`/ws`), README запуска | TODO |
| 7.9  | Тесты ядра (vitest): парсинг coverage→сегменты, мёрж live-событий | TODO |
| 7.10 | Документация (report/apply/code) | TODO |

## Ограничители (из обсуждения)

- Гант на div-ах (не SVG/canvas): рендерим только сегменты в окне `[from,to]`, виртуализация строк,
  сетка фоном; точечный апдейт колбаски по WS.
- Биржи уровня 1 — статическая навигация до появления каталога-эндпоинта.

## Критерии приёмки

- `pnpm dev` поднимает SPA, проксирует на живой OHS; `pnpm build` и `pnpm test` зелёные.
- На карточке провайдера: connect → индикатор «connected»; Start по инструменту → появляется колбаска
  и растёт (WS `coverageExtended`); Stop → колбаска закрывается.
- Ядро (`core/`) покрыто unit-тестами без DOM.

## Deliverables

- `services/online-history-server/web/**` — приложение.
- `docs/dev/phase7/{plan,apply,report}.md`, обновление `../plan.md`.
