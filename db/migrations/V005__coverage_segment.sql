-- Сегмент записи (сессия) — «колбаска» на Ганте покрытия.
-- Внутрисессионные дыры не храним: выводятся запросом из md_trade по порогу GapThreshold.
CREATE TABLE IF NOT EXISTS coverage_segment (
    segment_id    BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    instrument_id BIGINT      NOT NULL REFERENCES instrument (instrument_id),
    source_id     SMALLINT    NOT NULL REFERENCES data_source (source_id),
    started_at    TIMESTAMPTZ NOT NULL,
    ended_at      TIMESTAMPTZ,                              -- NULL = запись активна
    trade_count   BIGINT      NOT NULL DEFAULT 0,
    status        TEXT        NOT NULL DEFAULT 'recording', -- recording / stopped / error
    CONSTRAINT ck_coverage_status CHECK (status IN ('recording', 'stopped', 'error'))
);

-- Выборка сегментов по инструменту/источнику в окне Ганта.
CREATE INDEX IF NOT EXISTS ix_coverage_instrument_source_start
    ON coverage_segment (instrument_id, source_id, started_at);

-- Инвариант: не более одного активного сегмента на (instrument, source).
CREATE UNIQUE INDEX IF NOT EXISTS uq_coverage_active
    ON coverage_segment (instrument_id, source_id) WHERE ended_at IS NULL;
