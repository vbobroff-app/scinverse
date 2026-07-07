-- Деривативы (Решение 2): атрибуты контракта FUT/OPT и риск-параметры с историей.

-- Атрибуты контракта (только FUT/OPT), 1:1 с instrument (class-table inheritance).
CREATE TABLE IF NOT EXISTS derivative (
    instrument_id BIGINT  PRIMARY KEY REFERENCES instrument (instrument_id),
    underlying_id BIGINT  NOT NULL REFERENCES instrument (instrument_id),  -- базовый актив
    expiration    DATE    NOT NULL,
    option_type   CHAR(1),        -- 'C'/'P'; NULL для фьючерса
    strike        NUMERIC,        -- NULL для фьючерса
    CONSTRAINT ck_derivative_option_type CHECK (option_type IN ('C', 'P'))
);

-- Покрывает выборку опционной цепочки: базовый актив + экспирация + страйк.
CREATE INDEX IF NOT EXISTS ix_derivative_chain
    ON derivative (underlying_id, expiration, strike);

-- Волатильные риск-параметры с историей (темпоральная таблица).
CREATE TABLE IF NOT EXISTS instrument_risk (
    instrument_id    BIGINT      NOT NULL REFERENCES instrument (instrument_id),
    valid_from       TIMESTAMPTZ NOT NULL,
    initial_margin   NUMERIC,     -- ГО
    price_limit_low  NUMERIC,
    price_limit_high NUMERIC,
    CONSTRAINT pk_instrument_risk PRIMARY KEY (instrument_id, valid_from)
);
