-- Phase 11.2: долговременный аудит-лог ленты уведомлений (Notification Center).
-- До этого события жили только в in-memory ring-buffer (NotificationHub) + сессии фронта.
-- Пишем ВСЕ события (полный аудит); фильтрация — на чтении. TimescaleDB hypertable по ts + retention.
-- Актор-след (кто/что породило): actor_kind/actor_id/actor_label; для user это Keycloak sub (phase 10),
-- до auth — заглушка 'superuser'/'Оператор'. actor_label — неизменяемый снимок имени на момент события.
-- См. docs/dev/phase11/persistence.md.
CREATE TABLE IF NOT EXISTS notification (
    event_id       UUID        NOT NULL,           -- = NotificationDto.Id (Guid хаба)
    ts             TIMESTAMPTZ NOT NULL,           -- время события (UTC)
    severity       TEXT        NOT NULL CHECK (severity IN ('ok', 'info', 'warning', 'error', 'critical')),
    source_type    TEXT        NOT NULL CHECK (source_type IN ('user', 'system', 'external')),
    interaction    TEXT        NULL CHECK (interaction IS NULL OR interaction IN ('user', 'system')),
    localization   TEXT        NULL CHECK (localization IS NULL OR localization IN ('internal', 'external')),
    status         TEXT        NULL CHECK (status IS NULL OR status IN ('active', 'underway', 'resolved')),
    module         TEXT        NOT NULL,
    code           TEXT        NOT NULL,
    message        TEXT        NOT NULL,
    subject        TEXT        NULL,               -- квалификатор инцидента без :uid (для поиска)
    correlation_id TEXT        NULL,               -- subject:uid — история одного инцидента
    actor_kind     TEXT        NOT NULL DEFAULT 'system' CHECK (actor_kind IN ('user', 'system', 'external')),
    actor_id       TEXT        NULL,               -- user→Keycloak sub; system→сервис/модуль; external→коннектор/source
    actor_label    TEXT        NULL,               -- неизменяемый снимок отображаемого имени
    data           JSONB       NULL,
    -- PK включает партиционный ключ ts (требование TimescaleDB к unique/PK); ts детерминирован
    -- для события → ON CONFLICT (event_id, ts) DO NOTHING даёт идемпотентный insert.
    CONSTRAINT pk_notification PRIMARY KEY (event_id, ts)
);

-- Hypertable с партиционированием по времени (чанки по 1 дню — как md_trade).
SELECT create_hypertable(
    'notification', 'ts',
    if_not_exists       => TRUE,
    chunk_time_interval => INTERVAL '1 day'
);

-- Retention: события живут ограниченное время (аудит-лог, не вечный архив).
SELECT add_retention_policy('notification', INTERVAL '90 days', if_not_exists => TRUE);

-- Лента (последние N по времени).
CREATE INDEX IF NOT EXISTS ix_notification_ts       ON notification (ts DESC);
-- История одного инцидента / все инциденты subject-префикса.
CREATE INDEX IF NOT EXISTS ix_notification_corr     ON notification (correlation_id, ts DESC)
    WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_notification_subject  ON notification (subject, ts DESC)
    WHERE subject IS NOT NULL;
-- «Что менял этот пользователь / сервис».
CREATE INDEX IF NOT EXISTS ix_notification_actor    ON notification (actor_kind, actor_id, ts DESC);
-- Бейдж/фильтр по важности.
CREATE INDEX IF NOT EXISTS ix_notification_sev_ts   ON notification (severity, ts DESC);
