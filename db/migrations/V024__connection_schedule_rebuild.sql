-- Phase 7j v2: якорная модель сессии + слоистые исключения расписания соединения.
-- Пересоздание connection_schedule (production ещё нет).
--   Было:  одно окно суток (window_start/window_end) + mode(manual|scheduled) на строке (SCD-2 по окну).
--   Стало: правила (main/dow/date) со SCD-2 + отдельные per-connection настройки (auto/engine/tz).
-- Сессия = open_time + duration_min (полуинтервал [open, open+dur), delta < 24ч) и ПРИНАДЛЕЖИТ дню открытия.
-- Приоритеты: date > dow > main; внутри уровня — свежесть (effective_from). См. docs/dev/phase7j.
DROP TABLE IF EXISTS connection_schedule CASCADE;

-- Настройки уровня соединения: Auto + ведущий календарь дней + tz (общие для всех правил).
CREATE TABLE IF NOT EXISTS connection_schedule_settings (
    connection_id   BIGINT      PRIMARY KEY REFERENCES connector_connection (connection_id) ON DELETE CASCADE,
    auto_enabled    BOOLEAN     NOT NULL DEFAULT FALSE,
    engine          TEXT        NOT NULL DEFAULT 'futures',
    tz              TEXT        NOT NULL DEFAULT 'Europe/Moscow',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Слоистые правила расписания (SCD-2). Одна строка = одно правило одного скоупа.
CREATE TABLE IF NOT EXISTS connection_schedule (
    schedule_id     BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    connection_id   BIGINT       NOT NULL REFERENCES connector_connection (connection_id) ON DELETE CASCADE,
    scope_kind      TEXT         NOT NULL CHECK (scope_kind IN ('main', 'dow', 'date')),
    -- dow: битовая маска дней ОТКРЫТИЯ (Пн=1, Вт=2, Ср=4, Чт=8, Пт=16, Сб=32, Вс=64).
    dow_mask        SMALLINT     NULL CHECK (dow_mask IS NULL OR (dow_mask BETWEEN 1 AND 127)),
    -- date: диапазон дат открытия (v2).
    date_from       DATE         NULL,
    date_to         DATE         NULL,
    mode            TEXT         NOT NULL CHECK (mode IN ('window', 'off')),
    open_time       TIME         NULL,
    duration_min    INTEGER      NULL CHECK (duration_min IS NULL OR (duration_min BETWEEN 1 AND 1439)),
    effective_from  TIMESTAMPTZ  NOT NULL,
    effective_to    TIMESTAMPTZ  NULL,
    close_reason    TEXT         NULL CHECK (close_reason IN ('superseded', 'canceled')),
    change_source   TEXT         NOT NULL,
    change_note     TEXT         NULL,
    CONSTRAINT ck_connection_schedule_span
        CHECK (effective_to IS NULL OR effective_to >= effective_from),
    -- window ⇒ окно задано; off ⇒ окно не требуется.
    CONSTRAINT ck_connection_schedule_window
        CHECK ((mode = 'window' AND open_time IS NOT NULL AND duration_min IS NOT NULL)
            OR (mode = 'off')),
    -- Скоуп согласован с полезной нагрузкой.
    CONSTRAINT ck_connection_schedule_scope
        CHECK ((scope_kind = 'main' AND dow_mask IS NULL AND date_from IS NULL AND date_to IS NULL)
            OR (scope_kind = 'dow'  AND dow_mask IS NOT NULL AND date_from IS NULL AND date_to IS NULL)
            OR (scope_kind = 'date' AND date_from IS NOT NULL AND date_to IS NOT NULL AND dow_mask IS NULL
                AND date_to >= date_from))
);

-- Не более одного живого main на подключение.
CREATE UNIQUE INDEX IF NOT EXISTS uq_connection_schedule_main_current
    ON connection_schedule (connection_id)
    WHERE effective_to IS NULL AND scope_kind = 'main';

-- Живые правила подключения (их грузит резолвер).
CREATE INDEX IF NOT EXISTS ix_connection_schedule_live
    ON connection_schedule (connection_id)
    WHERE effective_to IS NULL;

-- История версий.
CREATE INDEX IF NOT EXISTS ix_connection_schedule_conn_from
    ON connection_schedule (connection_id, effective_from DESC);
