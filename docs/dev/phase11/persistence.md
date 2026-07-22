# Phase 11 — Долговременное хранение ленты уведомлений (NC persistence)

**Статус:** `DONE` (миграция V025 + домен + стор + фоновый writer + гидратация + фронт-DTO).
**Обновлено:** 2026-07-22. Сборка бэка — зелёная (проверено на temp-output, т.к. Host занят из VS);
`NotificationHubTests` 5/5; фронт `tsc` 0 / `eslint` 0 err / vitest 27. Integration/API (Testcontainers)
требуют Docker — прогон за пользователем.
**Связано:** [plan.md](plan.md) (§11.2, out-of-scope thin), [apply.md](apply.md) (оси A/B, incident-хаб),
[../phase10/plan.md](../phase10/plan.md) (Keycloak `sub`), [../phase7j/notify-composer.md](../phase7j/notify-composer.md).

Тонкая версия центра уведомлений (phase 11.2) держит события только в **in-memory ring-buffer**
(`NotificationHub`, 500 записей) + сессионной ленте фронта. Долговременный аудит-лог был вынесен в
out-of-scope. Этот док проектирует его: таблицу, актор-след (кто/что породило событие, forward-compat
с Keycloak), пути записи/чтения. Реализация — миграция `V025` + домен + стор + writer.

---

## 1. Объектная модель (что персистим)

Событие уже имеет зеркальные контракты. Бэковый `NotificationDto` (`NotificationHub.cs`):

| Поле | Тип | Заметка |
|------|-----|---------|
| `Id` | string (Guid `N`) | уникален на событие → `event_id UUID` (идемпотентный insert) |
| `Ts` | DateTimeOffset | время события (хранение UTC) |
| `Severity` | string | `ok\|info\|warning\|error\|critical` |
| `SourceType` | string | `user\|system\|external` (legacy-ось) |
| `Module` | string | `ohs.connection`, `connector.transaq`, … |
| `Code` | string | машинный код (`connection.schedule.rule_set`) |
| `Message` | string | человекочитаемое (без секретов) |
| `Status` | string? | ось B: `active\|underway\|resolved` |
| `CorrelationId` | string? | `subject:uid` — история одного инцидента |
| `Data` | JsonElement? | контекст (без секретов) |

Фронтовый `NotificationEvent` **богаче** и уже несёт две оси атрибуции, которые бэк сейчас **не
эмитит**, а выводит на клиенте (`resolveInteraction`/`resolveLocalization`):

- `interaction: 'user' | 'system'` — **кто инициировал** (основа «кто менял»);
- `localization: 'internal' | 'external'` — свой сервис vs **внешний** (коннектор/ISS);

При персисте эти оси **материализуем** на бэке (сейчас теряются между хабом и БД).

---

## 2. Актор-след (кто/что породило событие)

Требование: `user`-события должны оставлять след «кто именно менял»; `system`/`external` — какой
сервис/коннектор. Модель уже это учитывает через `interaction`/`localization`; добавляем явный
**принципал** классическим audit-паттерном **ссылка + неизменяемый снимок**:

| Поле | Смысл |
|------|-------|
| `actor_kind` | `user\|system\|external` — класс принципала |
| `actor_id` | ссылка: `user` → **Keycloak `sub`** (тот же ключ, что `user_settings.user_id`, phase 10); `system` → имя сервиса/модуля (`ConnectionSupervisor`, `ohs.host`); `external` → коннектор / `source_id` (`transaq`, `moex.iss`) |
| `actor_label` | **неизменяемый снимок** отображаемого имени на момент события (`preferred_username` и т.п.) |

Почему снимок, а не FK на пользователя:

- Отдельной таблицы пользователей не будет — phase 10 кеится **прямо по `sub`** (см.
  `user_settings(user_id TEXT PK)`). Актор-пользователь = `sub` тем же паттерном.
- Аудит-лог **иммутабельный**: если пользователя переименуют/удалят в Keycloak — строка лога должна
  остаться читаемой и не врать. Поэтому имя фиксируем снимком, ссылку — `sub`.
- До подключения Keycloak: `user`-события пишутся из REST-эндпоинтов без auth →
  `actor_kind='user'`, `actor_id='superuser'`, `actor_label='Оператор'` (заглушка единственного
  встроенного оператора; `superuser` не входит в RBAC-роли phase 10 `viewer/operator/admin` — не
  путается с ролью). Контракт готов заранее — когда появится `HttpContext.User`, эндпоинты прокинут
  `sub`+`preferred_username`, схема не меняется; `'superuser'` останется валидным историческим
  `actor_id` в старых строках лога.

---

## 3. Схема БД (`V025__notification_log.sql`)

TimescaleDB **hypertable** по `ts` (append-only лента событий) + retention policy. PK включает
партиционный ключ `ts` (требование Timescale к unique/PK) — как в `md_trade` (`V002`).
`ON CONFLICT (event_id, ts) DO NOTHING` даёт дедуп (ts детерминирован для события).

```sql
-- Phase 11.2: долговременный аудит-лог ленты уведомлений (NC).
CREATE TABLE IF NOT EXISTS notification (
    event_id       UUID        NOT NULL,           -- = NotificationDto.Id (Guid хаба)
    ts             TIMESTAMPTZ NOT NULL,           -- время события (UTC)
    severity       TEXT        NOT NULL CHECK (severity IN ('ok','info','warning','error','critical')),
    source_type    TEXT        NOT NULL CHECK (source_type IN ('user','system','external')),
    interaction    TEXT        NULL CHECK (interaction IN ('user','system')),        -- кто инициировал
    localization   TEXT        NULL CHECK (localization IN ('internal','external')), -- внутр./внешний контур
    status         TEXT        NULL CHECK (status IN ('active','underway','resolved')),
    module         TEXT        NOT NULL,
    code           TEXT        NOT NULL,
    message        TEXT        NOT NULL,
    subject        TEXT        NULL,               -- квалификатор инцидента без :uid (для поиска)
    correlation_id TEXT        NULL,               -- subject:uid — история одного инцидента
    -- Актор — след «кто/что породило», forward-compat с Keycloak (phase 10):
    actor_kind     TEXT        NOT NULL DEFAULT 'system' CHECK (actor_kind IN ('user','system','external')),
    actor_id       TEXT        NULL,
    actor_label    TEXT        NULL,
    data           JSONB       NULL,
    CONSTRAINT pk_notification PRIMARY KEY (event_id, ts)
);

-- Hypertable по времени (чанки по 1 дню — как md_trade).
SELECT create_hypertable(
    'notification', 'ts',
    if_not_exists       => TRUE,
    chunk_time_interval => INTERVAL '1 day'
);

-- Retention: события живут ограниченное время (уточнить срок; ориентир — 90 дней).
SELECT add_retention_policy('notification', INTERVAL '90 days', if_not_exists => TRUE);

-- Лента (последние N по времени).
CREATE INDEX IF NOT EXISTS ix_notification_ts       ON notification (ts DESC);
-- История одного инцидента / все инциденты subject-префикса.
CREATE INDEX IF NOT EXISTS ix_notification_corr      ON notification (correlation_id, ts DESC)
    WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_notification_subject   ON notification (subject, ts DESC)
    WHERE subject IS NOT NULL;
-- «Что менял этот пользователь / сервис».
CREATE INDEX IF NOT EXISTS ix_notification_actor     ON notification (actor_kind, actor_id, ts DESC);
-- Бэйдж/фильтр по важности.
CREATE INDEX IF NOT EXISTS ix_notification_sev_ts    ON notification (severity, ts DESC);
```

Пишем **все** события (полный аудит, включая `info`/`ok`) — фильтрация на чтении.

---

## 4. Обвязка бэкенда

1. **Домен** (`Scinverse.Ohs.Domain`): `NotificationRecord` (все поля таблицы) +
   `NotificationActor(Kind, Id, Label)`.
2. **Стор** (`Storage.Timescale`, Dapper/Npgsql — как `LinkLivenessStore`):
   `INotificationStore.AppendBatchAsync(records)` (`ON CONFLICT DO NOTHING`),
   `QueryAsync(filter)` — `severity`/`sourceType`/`module`/`since`/`correlationId`/`limit`.
3. **Неблокирующая запись:** хаб пишет событие в `Channel<NotificationDto>`; фоновый
   `NotificationPersistWriter : BackgroundService` дренит и **батч-инсертит** (стиль батчеров проекта).
   `Publish`/`Broadcast` остаются синхронными и быстрыми. Точка врезки — единственный
   `NotificationHub.EnqueueLocked` (после enqueue в ring-buffer, вне `_gate`).
4. **Актор в API хаба:** расширить `Publish/Open/Progress/Resolve` опциональным
   `NotificationActor?` (дефолты: `user`→`superuser`/`Оператор`, `system`→`module`,
   `external`→коннектор). Эндпоинты user-действий позже прокинут принципала из `HttpContext.User`
   (phase 10), заменив заглушку `superuser` на реальный `sub`.
5. **subject:** хаб знает `subject` в `Open/Progress/Resolve` — сохраняем в колонку явно; для
   `Publish`-пути (`compose`, фазы connect) `subject` = `NULL` либо задаётся продюсером.

---

## 5. Пути чтения и восстановление

- **`GET /api/notifications`** остаётся на тёплом ring-buffer (`Publish` пишет в буфер синхронно —
  бэклог всегда актуален, без гонки с асинхронной записью в БД). БД — долговременный аудит-лог.
- **Гидратация буфера на старте:** фоновый writer при инициализации грузит из БД последние N
  (`hub.Hydrate`, тёплый кеш ленты), чтобы бэклог переживал рестарт Host. Ошибка БД — не фатальна.
- **Восстановление открытых инцидентов (`_openIncidents`):** сейчас эфемерно; при рестарте ЖЦ теряется.
  С БД можно перечитать последний `status` по каждому живому `correlation_id` (не `resolved`) и
  восстановить карту. Для v1 — опционально (аудит-лог самодостаточен); отметить как follow-up.
- **Фронт не ломается:** тот же `NotificationDto`. Опционально расширить DTO полями
  `interaction`/`localization`/`actorLabel` (сейчас фронт их выводит сам) — обратносовместимо.

---

## 6. Открытые вопросы

- Точный срок retention (ориентир 90 дней) — уточнить под требования аудита.
- Порог/скраб `data` (гарантия «без секретов» перед записью) — общий инвариант phase 11.
- Нужен ли отдельный `entity_ref` (напр. `connection_id`) поверх `subject`/`data` для прямых join —
  пока покрываем `subject` + `data` JSONB.
- Continuous aggregate по severity/дню для дашборда — перспектива, не для v1.

---

## 7. Файлы

| Роль | Путь |
|------|------|
| Миграция | `db/migrations/V025__notification_log.sql` |
| Домен | `…/Scinverse.Ohs.Domain/NotificationRecord.cs` (`NotificationRecord` + `NotificationActor`), `INotificationStore.cs` |
| Стор | `…/Scinverse.Ohs.Storage.Timescale/NotificationStore.cs` |
| Очередь / writer | `…/Scinverse.Ohs.Host/NotificationPersistQueue.cs`, `NotificationPersistWriter.cs` (BackgroundService: гидратация + drain-батч) |
| Маппинг | `…/Scinverse.Ohs.Host/NotificationMapping.cs` (DTO ↔ record) |
| Хаб | `…/Scinverse.Ohs.Host/NotificationHub.cs` (расширенный DTO, `Superuser`, актор/оси, Channel-врезка, `Hydrate`) |
| Публикатор | `…/Scinverse.Ohs.Host/INotificationPublisher.cs` (опц. `NotificationActor`/`subject`) |
| DI | `…/Scinverse.Ohs.Host/Program.cs` (`INotificationStore`, `NotificationPersistQueue`, hosted `NotificationPersistWriter`) |
| Фронт | `web/src/core/types.ts` (`NotificationDto` +interaction/localization/actorLabel), `notifications.ts` (адаптер) |
| Тесты | `tests/Scinverse.Ohs.IntegrationTests/NotificationStoreTests.cs` |
