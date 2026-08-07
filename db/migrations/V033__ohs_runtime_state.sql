-- Durable Host checkpoints (суточный checkup переживает рестарт процесса).
CREATE TABLE IF NOT EXISTS ohs_runtime_state (
    key         TEXT        PRIMARY KEY,
    value       TEXT        NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
