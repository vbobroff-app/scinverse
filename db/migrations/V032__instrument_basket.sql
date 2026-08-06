-- catalog-basket-instruments v1 (C0): наборы Observed per-connection.
-- Available по-прежнему instrument.active; здесь — правила + снимок членства static.
-- System recording/has_data — строки kind=system; членство recording live в Host (не basket_member).

CREATE TABLE IF NOT EXISTS instrument_basket (
    basket_id     BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    connection_id BIGINT      NOT NULL REFERENCES connector_connection (connection_id) ON DELETE CASCADE,
    kind          TEXT        NOT NULL,
    name          TEXT        NOT NULL,
    system_id     TEXT        NULL,
    enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_instrument_basket_kind
        CHECK (kind IN ('static', 'dynamic', 'system')),
    CONSTRAINT ck_instrument_basket_system
        CHECK (
            (kind = 'system' AND system_id IS NOT NULL)
            OR (kind <> 'system' AND system_id IS NULL)
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_instrument_basket_system
    ON instrument_basket (connection_id, system_id)
    WHERE system_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_instrument_basket_connection
    ON instrument_basket (connection_id);

CREATE TABLE IF NOT EXISTS basket_rule (
    basket_id  BIGINT  NOT NULL PRIMARY KEY
        REFERENCES instrument_basket (basket_id) ON DELETE CASCADE,
    patterns   TEXT[]  NOT NULL DEFAULT '{}',
    sec_type   TEXT    NULL,
    board_id   TEXT    NULL
);

CREATE TABLE IF NOT EXISTS basket_member (
    basket_id     BIGINT NOT NULL
        REFERENCES instrument_basket (basket_id) ON DELETE CASCADE,
    instrument_id BIGINT NOT NULL
        REFERENCES instrument (instrument_id) ON DELETE CASCADE,
    PRIMARY KEY (basket_id, instrument_id)
);

CREATE INDEX IF NOT EXISTS ix_basket_member_instrument
    ON basket_member (instrument_id);
