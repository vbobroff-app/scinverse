-- Подключения коннекторов (управляются из UI в 6b). Секреты (login/password) НЕ храним:
-- в settings только несекретное (host/port/dllPath/timeouts); креды — в памяти сессии.
CREATE TABLE IF NOT EXISTS connector_connection (
    connection_id BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id     SMALLINT    NOT NULL REFERENCES data_source (source_id),
    name          TEXT        NOT NULL UNIQUE,
    kind          TEXT        NOT NULL,               -- transaq / synthetic
    settings      JSONB       NOT NULL DEFAULT '{}',  -- несекретные параметры подключения
    enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Демо-подключение без env-специфики (боевой transaq заводится в 6b из UI/конфига).
INSERT INTO connector_connection (source_id, name, kind, settings)
VALUES (2, 'synthetic-local', 'synthetic', '{}')
ON CONFLICT (name) DO NOTHING;
