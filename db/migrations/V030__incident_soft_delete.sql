-- Soft-delete журнал инцидентов: ось видимости (ортогональна status lifecycle).
ALTER TABLE incident
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS deleted_by TEXT NULL;

DROP INDEX IF EXISTS ix_incident_open;
CREATE INDEX IF NOT EXISTS ix_incident_open
    ON incident (module, status)
    WHERE status IN ('active', 'recovering') AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_incident_deleted
    ON incident (deleted_at)
    WHERE deleted_at IS NOT NULL;
