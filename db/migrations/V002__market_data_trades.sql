-- Лента всех сделок (alltrades) — базовый рыночный поток.
CREATE TABLE IF NOT EXISTS md_trade (
    ts            TIMESTAMPTZ NOT NULL,               -- биржевое время сделки
    instrument_id BIGINT      NOT NULL REFERENCES instrument (instrument_id),
    trade_no      BIGINT      NOT NULL,               -- биржевой номер (дедупликация)
    price_ticks   BIGINT      NOT NULL,
    quantity      INT         NOT NULL,               -- лоты
    side          SMALLINT    NOT NULL,               -- +1 = buy(инициатор), -1 = sell
    open_interest BIGINT,                             -- FORTS; NULL для остального
    ingest_ts     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_md_trade PRIMARY KEY (instrument_id, trade_no, ts)
);

-- Hypertable с партиционированием по времени (чанки по 1 дню).
SELECT create_hypertable(
    'md_trade', 'ts',
    if_not_exists     => TRUE,
    chunk_time_interval => INTERVAL '1 day'
);

-- Типовой доступ: последние сделки по инструменту.
CREATE INDEX IF NOT EXISTS ix_md_trade_instrument_ts
    ON md_trade (instrument_id, ts DESC);
