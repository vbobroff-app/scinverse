-- Справочники: рынки, режимы торгов, инструменты.
-- Расширение TimescaleDB (используется в последующих миграциях).
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS market (
    market_id INT  PRIMARY KEY,     -- id рынка TRANSAQ
    name      TEXT
);

CREATE TABLE IF NOT EXISTS board (
    board_id  TEXT PRIMARY KEY,     -- код режима торгов (TQBR, FUT, ...)
    market_id INT  REFERENCES market (market_id),
    name      TEXT
);

CREATE TABLE IF NOT EXISTS instrument (
    instrument_id BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    seccode       TEXT        NOT NULL,
    board_id      TEXT        NOT NULL REFERENCES board (board_id),
    market_id     INT         REFERENCES market (market_id),
    transaq_secid INT,                                    -- secid текущей сессии (нестабилен)
    short_name    TEXT,
    name          TEXT,
    sec_type      TEXT,                                   -- SHARE / FUT / OPT / BOND / CURRENCY
    decimals      SMALLINT,
    min_step      NUMERIC     NOT NULL,                   -- шаг цены (price_ticks <-> price)
    lot_size      INT,
    point_cost    NUMERIC,
    currency      TEXT,
    active        BOOLEAN     NOT NULL DEFAULT TRUE,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_instrument_key UNIQUE (seccode, board_id)
);
