# Scinverse OHS — админ-панель (web)

Внутренняя админка OHS (write-path): управление записью и Гант покрытия. React + TypeScript +
RxJS, сборка на Vite, тесты на Vitest. Архитектура — framework-agnostic ядро (`src/core`, RxJS) +
тонкий React-слой (`src/ui`). Дизайн фазы — в [`../../../docs/dev/phase7`](../../../docs/dev/phase7).

## Запуск (dev)

1. Поднять OHS-хост (REST `/api` + WebSocket `/ws`) на `http://localhost:5080`:

   ```bash
   dotnet run --project src/Scinverse.Ohs.Host
   ```

   (нужна поднятая TimescaleDB из `docker-compose`; демо-подключение `synthetic-local` уже засижено).

2. Установить зависимости и запустить дев-сервер (Vite проксирует `/api` и `/ws` на хост):

   ```bash
   pnpm install
   pnpm dev
   ```

   Открыть <http://localhost:5173>.

## Скрипты

- `pnpm dev` — дев-сервер с proxy на OHS.
- `pnpm build` — типизация (`tsc -b`) + прод-сборка Vite.
- `pnpm test` — unit-тесты ядра (Vitest).
- `pnpm lint` / `pnpm format` — ESLint / Prettier.

## Структура

```
src/
  core/   # RxJS, без React: types, api (rxjs/ajax), live (rxjs/webSocket), OhsStore
  ui/     # React: hooks (useObservable), components, pages, context
  styles/ # палитра (variables.css) + global.css
```
