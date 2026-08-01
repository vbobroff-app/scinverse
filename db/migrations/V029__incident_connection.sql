-- P5.1: 2NF crash scope — transport incident + M:N connections.
-- Crash: incident.connection_id IS NULL; scope rows in incident_connection.
-- Break: остаётся 1:1 на incident.connection_id (scope-таблица не обязательна).
-- См. docs/dev/phase11/plan-schedule-projection.md §P5.

CREATE TABLE IF NOT EXISTS incident_connection (
    corr_uid      TEXT    NOT NULL REFERENCES incident (corr_uid) ON DELETE CASCADE,
    connection_id BIGINT  NOT NULL REFERENCES connector_connection (connection_id) ON DELETE CASCADE,
    PRIMARY KEY (corr_uid, connection_id)
);

CREATE INDEX IF NOT EXISTS ix_incident_connection_by_connection
    ON incident_connection (connection_id, corr_uid);
