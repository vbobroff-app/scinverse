# Phase 7e. Особенности реализации

Конкретные решения фазы 7e. Обзор — в [plan.md](plan.md), статус — в [report.md](report.md).
Заполняется по ходу реализации.

## 1. Готовый бэкенд (переиспользуем)

- `POST /api/connections` — upsert (`UpsertConnectionRequest`: `sourceId`, `name`, `kind`,
  `settings`, `enabled`) → `ConnectionDto`.
- `PUT /api/connections/{id}/credentials` — `ConnectionCredentialsRequest` (`login`, `password`),
  write-only (in-memory `ICredentialStore`, в БД не пишутся).
- `POST /api/connections/{id}/{connect|disconnect|test}` → `ConnectionDto` с рантайм-статусом.
- Фабрика коннекторов (phase 6b) поддерживает `kind = transaq | synthetic`.

## 2. core: команды `OhsStore`

```ts
createConnection(req: UpsertConnectionRequest): void   // api.upsertConnection → upsertConnection(merge)
updateConnection(req: UpsertConnectionRequest): void    // тот же upsert (id внутри settings/name-ключ)
setConnectionCredentials(id: number, login: string, password: string): void
testConnection(id: number): void                        // api.test → merge статуса
```

Приватный `upsertConnection(connection)` (merge в `connections$`) уже есть — новые команды его
переиспользуют в `next`-колбэках.

## 3. UI

- `ConnectionsPanel`: кнопка «+ Подключение» открывает форму (модалка/боковая панель).
- Форма: `name`, `kind` (select), `source` (select из `sources$`), `settings` (textarea JSON или
  поля под kind), `enabled` (чекбокс). Сохранение → `createConnection`/`updateConnection`.
- Креды: форма login/password на `ProviderCard` → `setConnectionCredentials`.
- Флоу realtime: существующие кнопки «Подключить/Отключить/Тест» в `ProviderCard`.

## 4. Тесты

- **vitest** `OhsStore`: `createConnection`/`setConnectionCredentials`/`testConnection` вызывают
  соответствующий api-метод и мёржат `connections$`.
