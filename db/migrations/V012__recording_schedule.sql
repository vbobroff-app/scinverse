-- Phase 7i: политика автозаписи (полуавтомат). Пока только флаг Auto + connection_id
-- для Supervisor'а (arm/disarm по сессии MOEX). Полные mode/weekdays/window — later.
CREATE TABLE IF NOT EXISTS recording_schedule (
    instrument_id BIGINT      NOT NULL REFERENCES instrument (instrument_id) ON DELETE CASCADE,
    connection_id BIGINT      NOT NULL REFERENCES connector_connection (connection_id) ON DELETE CASCADE,
    auto_enabled  BOOLEAN     NOT NULL DEFAULT false,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (instrument_id)
);

CREATE INDEX IF NOT EXISTS ix_recording_schedule_auto
    ON recording_schedule (auto_enabled)
    WHERE auto_enabled;
