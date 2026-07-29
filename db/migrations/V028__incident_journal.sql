-- Phase 11.13a: first-class журнал инцидентов (OHS).
-- Одна строка = один corr / эпизод. Рядом с link_liveness (геометрия живости).
-- Поток notification (V025) — отдельно; to-be уедет в NC. См. docs/dev/phase11/incident-journal.md.
CREATE TABLE IF NOT EXISTS incident (
    corr_uid          TEXT         PRIMARY KEY,
    module            TEXT         NOT NULL,
    type              TEXT         NOT NULL,
    status            TEXT         NOT NULL
                        CHECK (status IN ('active', 'recovering', 'resolved')),
    close_outcome     TEXT         NULL
                        CHECK (close_outcome IN (
                            'recovered', 'abandoned_schedule', 'abandoned_manual')),
    opened_at         TIMESTAMPTZ  NOT NULL,
    closed_at         TIMESTAMPTZ  NULL,
    subject           TEXT         NOT NULL,
    severity          TEXT         NOT NULL
                        CHECK (severity IN ('ok', 'info', 'warning', 'error', 'critical')),
    title             TEXT         NOT NULL DEFAULT '',
    last_activity_at  TIMESTAMPTZ  NOT NULL,
    -- connection (NULL для других module); connection_id = BIGINT как connector_connection
    connection_id     BIGINT       NULL,
    source_id         SMALLINT     NULL,
    escalated_at      TIMESTAMPTZ  NULL,
    subtype           TEXT         NULL,
    owner             TEXT         NULL,
    payload           JSONB        NULL,
    CHECK (closed_at IS NULL OR closed_at >= opened_at),
    CHECK (
        (status = 'resolved' AND closed_at IS NOT NULL AND close_outcome IS NOT NULL)
        OR (status <> 'resolved' AND closed_at IS NULL AND close_outcome IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS ix_incident_journal
    ON incident (module, status, opened_at DESC);

CREATE INDEX IF NOT EXISTS ix_incident_connection_window
    ON incident (connection_id, opened_at DESC)
    WHERE module = 'connection' AND connection_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_incident_open
    ON incident (module, status)
    WHERE status IN ('active', 'recovering');
