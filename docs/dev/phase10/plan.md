# Phase 10. Multi-user & auth (Keycloak)

Многопользовательский режим: авторизация, сохранение пользовательских настроек и примитивная
ролевая модель. Сквозная фаза — identity общая для всей сервис-ориентированной системы (.NET
горячий контур + Python холодный контур валидируют один OIDC-токен). Дизайн Stage 1 — в
[../apply.md](../apply.md); детали реализации — в [apply.md](apply.md); статус — в
[report.md](report.md).

**Статус:** `PLANNED`. **Stage:** 1 (сквозная). **Зависимости:** нет жёстких; стартует, когда нужен
многопользовательский режим. Влияет на все REST/WS-эндпоинты OHS.

## Решение (зафиксировано)

- **IdP — Keycloak** (self-hosted, OIDC/JWT). Причины: единая identity для ASP.NET Core и FastAPI
  (оба валидируют bearer из коробки), встроенный RBAC (realm/client roles) под «примитивные роли»,
  задел на 2FA/SSO/соц-логины/федерацию без собственного кода.
- **Пользовательские настройки — в своём Postgres** (таблица/сервис `user_settings`, ключ = Keycloak
  `sub`), НЕ в Keycloak. Так закрываем «базу настроек» (что нравилось в Appwrite) без чужого рантайма.
- **Отвергнуто:** Appwrite (Node-BaaS, инородный .NET-first бэкенду); собственный auth на ASP.NET
  Core Identity (валиден как «лёгкий» путь, но роли/2FA/SSO пришлось бы растить самим) — см.
  сравнение в [apply.md](apply.md).

## Ролевая модель (примитивная)

- `viewer` — только чтение (каталог, Гант, покрытие).
- `operator` — + управление записью (старт/стоп), подключения (connect/disconnect/test).
- `admin` — + создание/редактирование подключений, ввод кред, обслуживание.

Роли — client roles в Keycloak, маппятся в claims токена; сервер гейтит эндпоинты через политики
авторизации.

## Область (in scope)

- **10.1 Инфраструктура.** Keycloak в `docker-compose` (образ запинен), realm `scinverse`, клиенты:
  `scinverse-web` (public SPA, PKCE) и `scinverse-api` (bearer-only). Realm-конфиг как код (import
  JSON), пиннинг версии.
- **10.2 Backend (горячий, ASP.NET Core).** JWT bearer аутентификация (authority = Keycloak realm),
  политики ролей (`viewer`/`operator`/`admin`), `[Authorize]` на OHS-эндпоинтах; управляющие
  операции (запись/подключения) — под `operator+`. WS `/ws` — авторизация по токену.
- **10.3 Backend (холодный, Python/FastAPI).** Тот же realm: валидация JWT (JWKS), зависимость
  `require_role` — задел (когда появятся Python-сервисы аналитики).
- **10.4 `user_settings`.** Миграция `V0NN` (таблица `user_settings(user_id text PK, prefs jsonb,
  updated_at)`), REST `GET/PUT /api/me/settings` (по `sub` из токена). Хранит весь снимок
  представления UI (последние фильтры, таймфрейм, тайм-лайн-фильтр, ТЗ, тумблеры Ганта, раскрытые
  узлы дерева, выбранные инструменты, тему). Точный состав `prefs` и план переноса из localStorage —
  в разделе [«Пользовательские настройки»](#пользовательские-настройки-user_settings--что-переносим-из-localstorage).
- **10.5 Frontend.** OIDC-логин (`oidc-client-ts`/react), хранение/refresh токена, прикрепление
  bearer к `/api` и `/ws`; загрузка/сохранение настроек через `OhsStore` (гидратация UI из
  `user_settings`, автосейв при изменениях). Гейтинг UI по ролям (скрыть управляющие действия у
  `viewer`).
- **10.6 Тесты.** Backend: авторизация (401 без токена, 403 при нехватке роли, 200 с ролью) через
  тестовый токен-issuer; `user_settings` round-trip. Frontend: гидратация/сейв настроек, гейтинг по
  ролям (vitest).

## Пользовательские настройки (`user_settings`) — что переносим из localStorage

Сейчас UI-состояние живёт в браузере (localStorage, синглтон `OhsStore`). При появлении профилей
это состояние переезжает в БД OHS и привязывается к пользователю. Ниже — авторитетная инвентаризация
текущих ключей localStorage (фронт `services/online-history-server/web`), которые становятся полями
`prefs`.

### Где хранить (решение и обоснование)

- **Настройки UI — в своём Postgres, НЕ в Keycloak.** Keycloak-атрибуты предназначены для
  идентификационных метаданных, кэшируются в памяти сервера и ограничены по длине; официальная
  рекомендация — «хранить крупные объекты вне Keycloak и ссылаться на них по id/URL». Наш JSON
  настроек (фильтры, дерево, выделение) — именно такой прикладной объект.
  Док: [Keycloak — User profile / attributes](https://github.com/keycloak/keycloak/blob/main/docs/documentation/server_admin/topics/users/user-profile.adoc)
  («Consider storing large objects outside Keycloak…», «limiting the size of the attributes is recommended»).
- **Ключ — `sub` из токена** (в паре с `iss` — глобально уникален; сам по себе `sub` уникален в
  рамках issuer). Тип subject — `public` (по умолчанию), не `pairwise`, чтобы `sub` был стабилен для
  наших клиентов. Внешний БД-ключ по `sub` — стандартная и безопасная практика.
  Док: [OIDC `sub` в Keycloak / StackOverflow](https://stackoverflow.com/questions/72586538/is-it-safe-to-use-sub-claim-in-keycloak-token-for-user-id-in-internal-db).

### Схема

```sql
CREATE TABLE user_settings (
    user_id     TEXT        PRIMARY KEY,          -- Keycloak sub (issuer фиксирован конфигом realm)
    prefs       JSONB       NOT NULL DEFAULT '{}',-- версионируемый снимок UI (см. ниже)
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`prefs` — версионированный JSON (`schemaVersion` для будущих миграций формы). Крупных объектов нет,
поэтому одна строка на пользователя достаточна; при росте — вынести выделение/дерево в отдельные
поля/таблицы.

### Состав `prefs` (что переносим из localStorage)

| Сейчас в localStorage | Ключ/поле | В `prefs` | Заметки |
| --- | --- | --- | --- |
| Тема оформления | `theme` (`light`/`dark`) | `theme` | `main.tsx`, `HeaderControls.tsx` |
| Выбранные инструменты | `ohs:selectedInstruments` (`number[]`) | `selectedInstruments` | `selectedInstrumentsStorage.ts` |
| Активный провайдер | `ohs:viewState.activeConnectionId` | `activeConnectionId` | `connection_id` (может протухнуть → валидировать при гидратации) |
| Плашки-фильтры | `ohs:viewState.activeFilters` (`FilterKey[]`) | `activeFilters` | набор активных фильтр-чипов |
| Категория / recording / nonEmpty / exchanges / selected | `ohs:viewState.{category,onlyRecording,nonEmpty,exchanges,selected}` | те же поля | параметры запроса каталога |
| Раскрытые фьючерсы | `ohs:viewState.expandedFutures` (`number[]`) | `expandedFutures` | регидрация дерева |
| Раскрытые серии | `ohs:viewState.expandedSeries` (`{futuresId,expiration}[]`) | `expandedSeries` | регидрация дерева |
| Таймфрейм | `ohs:viewState.timeframe` (`Timeframe`) | `timeframe` | D/W/M/Q/Y/All/range + includeWeekends |
| Тайм-лайн-фильтр | `ohs:viewState.timeline` (`{weekdays:number[],fullDay,session}`) | `timeline` | «Дни» + «Окно дня»/сессия |
| Стандарт времени | `ohs:viewState.displayTz` (`{preset,offsetMin}`) | `displayTz` | ось/тултипы |
| Тумблер crosshair | `ohs:viewState.crosshair` (`bool`) | `crosshair` | вертикальный time-line над Гантом |
| Подсветка дней | `ohs:viewState.highlightDays` (`bool`) | `highlightDays` | обводка границ дней над Гантом |

Форма-ориентир (объединяет текущие ключи `theme` + `ohs:selectedInstruments` + `ohs:viewState`):

```jsonc
{
  "schemaVersion": 1,
  "theme": "dark",
  "selectedInstruments": [101, 202],
  "catalog": {
    "activeConnectionId": 3,
    "activeFilters": ["instruments", "selection"],
    "category": "futures",
    "onlyRecording": true,
    "nonEmpty": false,
    "selected": true,
    "exchanges": ["MOEX"],
    "expandedFutures": [100],
    "expandedSeries": [{ "futuresId": 100, "expiration": "2026-07-16" }]
  },
  "gantt": {
    "timeframe": { "kind": "sessions", "unit": "W", "count": 2, "includeWeekends": false },
    "timeline": { "weekdays": [1,2,3,4,5], "fullDay": false, "session": { "mode": "session", "exchange": "MOEX" } },
    "displayTz": { "preset": "msk", "offsetMin": 180 },
    "crosshair": true,
    "highlightDays": false
  }
}
```

### Стратегия переноса и гидратации

- **Источник истины после Keycloak — БД.** `OhsStore` уже централизует состояние и умеет
  сериализовать/десериализовать снимок (`viewStateStorage.ts`, `selectedInstrumentsStorage.ts`) —
  меняется только транспорт: `localStorage` → `GET/PUT /api/me/settings`. Гидратация из ответа
  `GET /api/me/settings` при старте, дебаунс-автосейв `PUT` при изменениях (переиспользуем текущие
  точки `persistView()`).
- **Гостевой/анонимный режим (если останется) — fallback на localStorage**; при первом логине —
  одноразовый merge локального снимка в `user_settings`.
- **Валидация при загрузке обязательна** (как сейчас в `loadViewState`): протухший
  `activeConnectionId`/несуществующая биржа/битые поля → отбрасываем к дефолтам, а не роняем UI.
- **Изоляция по `sub`**: сервер пишет/читает `prefs` только для `sub` из токена; чужой `user_id`
  недоступен (см. критерий приёмки 4).

## Вне области (out of scope)

- Соц-логины, федерация, самостоятельная регистрация — позже (Keycloak это даёт, но не в v1).
- Тонкие права на уровне инструментов/источников — только грубые роли.
- Мульти-тенант/организации — не требуется.
- Биллинг/квоты.

## Критерии приёмки

1. Вход через Keycloak; неавторизованный доступ к OHS API/WS → 401.
2. Роли работают: `viewer` не может стартовать запись/править подключения (403 + скрыто в UI),
   `operator`/`admin` — могут.
3. Настройки пользователя сохраняются и восстанавливаются между сессиями (фильтры/таймфрейм/layout).
4. Секреты/токены не логируются; `user_settings` изолированы по `sub`.
5. `dotnet build`/тесты, `tsc`/`vitest` зелёные; Keycloak поднимается из compose с realm-конфигом.

## Порядок

10.1 → 10.2 → 10.4 → 10.5 → 10.6; 10.3 (Python) — когда появится холодный контур. Детали — в
[apply.md](apply.md), статус — в [report.md](report.md).
