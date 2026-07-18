-- Phase 7j: расписание соединения (окно суток + Auto).
-- SCD-2 по окну (window_*/engine/tz): смена → закрыть текущую (effective_to) + INSERT.
-- mode (manual|scheduled) на текущей строке обновляется in-place — клики Auto не плодят историю.
-- Календарь дней — ведущий engine (без join рынков); типично futures/FORTS.
CREATE TABLE IF NOT EXISTS connection_schedule (
    schedule_id     BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    connection_id   BIGINT       NOT NULL REFERENCES connector_connection (connection_id) ON DELETE CASCADE,
    mode            TEXT         NOT NULL
        CHECK (mode IN ('manual', 'scheduled')),
    window_start    TIME         NOT NULL,
    window_end      TIME         NOT NULL,
    engine          TEXT         NOT NULL,
    tz              TEXT         NOT NULL DEFAULT 'Europe/Moscow',
    effective_from  TIMESTAMPTZ  NOT NULL,
    effective_to    TIMESTAMPTZ  NULL,
    change_source   TEXT         NOT NULL,
    change_note     TEXT         NULL,
    CONSTRAINT ck_connection_schedule_span
        CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- Ровно одна «живая» версия окна на подключение.
CREATE UNIQUE INDEX IF NOT EXISTS uq_connection_schedule_current
    ON connection_schedule (connection_id)
    WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS ix_connection_schedule_connection_from
    ON connection_schedule (connection_id, effective_from DESC);

CREATE INDEX IF NOT EXISTS ix_connection_schedule_scheduled
    ON connection_schedule (connection_id)
    WHERE effective_to IS NULL AND mode = 'scheduled';
