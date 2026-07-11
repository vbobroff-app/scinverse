# Phase 10. Особенности реализации

Конкретные решения фазы 10. Обзор — в [plan.md](plan.md), статус — в [report.md](report.md).
Заполняется по ходу реализации; ниже — зафиксированные проектные заметки и сравнение вариантов.

## Сравнение вариантов auth

| Критерий | Keycloak (выбран) | ASP.NET Core Identity (свой) | Appwrite |
| -------- | ----------------- | ---------------------------- | -------- |
| Интеграция с .NET | OIDC/JWT bearer из коробки | нативно | валидация чужого JWT |
| Интеграция с Python (FastAPI) | JWKS-валидация, стандарт | свой issuer → сами | чужой SDK |
| Роли/RBAC | встроено (realm/client roles) | встроено (`Identity` roles) | базово |
| 2FA / SSO / соц-логины | из коробки | растить самим | частично |
| Новый рантайм | +1 контейнер (JVM) | нет | +1 контейнер (Node) |
| Настройки пользователя | своя таблица Postgres | своя таблица Postgres | встроено (но lock-in) |
| Вердикт | **единая identity, задел на рост** | лёгкий старт, но потолок | инородно .NET-first |

Итог: Keycloak как IdP + собственная `user_settings` в Postgres.

## Компоненты (набросок)

- **Keycloak:** realm `scinverse`; клиенты `scinverse-web` (public, PKCE, redirect на SPA) и
  `scinverse-api` (bearer-only). Client roles: `viewer`/`operator`/`admin`. Realm-export JSON в репо,
  импорт при старте контейнера. Образ запинен в `docker-compose`.
- **ASP.NET Core:** `AddAuthentication().AddJwtBearer(authority = <realm>, audience = scinverse-api)`;
  политики `RequireRole("operator"|"admin")`; `[Authorize]` на группе `/api`, управляющие маршруты
  (recordings, connections) — под `operator+`. WS `/ws`: токен в query/subprotocol, проверка при
  апгрейде.
- **`user_settings`:** миграция DbUp `V0NN__user_settings.sql` — `user_id text PRIMARY KEY,
  prefs jsonb NOT NULL DEFAULT '{}', updated_at timestamptz`. REST `GET/PUT /api/me/settings`
  (`user_id = sub` из токена). `prefs` — свободный JSON (фронт владеет схемой: фильтры/таймфрейм/
  layout/тема/выбранное).
- **Frontend:** `oidc-client-ts` (PKCE), silent refresh; интерцептор bearer для `rxjs/ajax` и URL WS;
  `OhsStore` гидратируется из `/api/me/settings` на старте и дебаунс-сейвит изменения; роль из токена
  → скрытие управляющих действий у `viewer`.

## Открытые вопросы

- Точный список `prefs` (что именно персистим) — уточнить при старте фазы.
- Где рисовать логин (отдельная страница vs редирект Keycloak) — вероятно редирект (standard flow).
- Нужен ли отдельный identity-микросервис для `user_settings` или это эндпоинт в OHS Host — на старте
  проще в OHS Host, вынести позже при росте.
