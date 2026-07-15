-- Phase 7h.8 (follow-up): жизненный цикл СВЯЗИ на подключение (source), НЕЗАВИСИМО от записи.
-- В отличие от capture_liveness («связь жива И пишем», гейт по записи+сессии), link_liveness пишется
-- ВСЁ ВРЕМЯ, пока подключение connected: keepalive-тик двигает to_ts открытого интервала БЕЗ пинга,
-- по in-memory состоянию связи (Live/Degraded). Так лента Connection знает всю историю связи, в т.ч. вне
-- записи; проекция на инструмент = «слушаю ∩ связь лежит».
--
-- Негативное пространство между интервалами = «связь не жива», цвет по причине закрытия:
--   'disconnected' — пользователь отключил провайдера (НЕ разрыв, серый);
--   'server_down'  — server_status=false/error (обрыв связи, красный; to_ts = точное время события);
--   'ping_failed'  — тишина в сессии + активный пинг не прошёл («тихая смерть» DLL, красный);
--   'interrupted'  — краш хоста / пропуск keepalive-тиков; закрыто recovery на старте или split'ом (красный).
CREATE TABLE IF NOT EXISTS link_liveness (
    liveness_id  BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id    SMALLINT    NOT NULL REFERENCES data_source (source_id),
    from_ts      TIMESTAMPTZ NOT NULL,
    to_ts        TIMESTAMPTZ NOT NULL,
    open         BOOLEAN     NOT NULL DEFAULT true, -- true = интервал ещё продлевается keepalive
    close_reason TEXT        NULL
        CHECK (close_reason IN ('disconnected', 'server_down', 'ping_failed', 'interrupted')),
    CONSTRAINT ck_link_liveness_span CHECK (to_ts >= from_ts),
    -- Инвариант: открытый интервал ещё продлевается (причины нет), закрытый — всегда с причиной.
    CONSTRAINT ck_link_liveness_reason
        CHECK ((open AND close_reason IS NULL) OR (NOT open AND close_reason IS NOT NULL))
);

-- Выборка интервалов связи по источнику в окне Ганта.
CREATE INDEX IF NOT EXISTS ix_link_liveness_source_from
    ON link_liveness (source_id, from_ts);

-- Инвариант: не более одного открытого интервала на source.
CREATE UNIQUE INDEX IF NOT EXISTS uq_link_liveness_open
    ON link_liveness (source_id) WHERE open;
