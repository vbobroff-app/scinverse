-- Phase 7h: живость захвата (honest background). Положительное свидетельство «связь жива» в
-- КОМПАКТНОЙ интервальной форме на подключение (source). Пока связь жива, писатель хартбита раз в
-- ~15 c двигает to_ts открытого интервала; на обрыве/стопе интервал закрывается (open=false), на
-- восстановлении открывается новый. Сырой realtime-лог НЕ храним — рост ~ по числу обрывов, не времени.
--
-- Честная подложка Ганта = coverage_segment ∩ capture_liveness. Зазор между интервалами живости
-- (в т.ч. из-за падения хоста: to_ts замирает на последнем хартбите) = реальная дыра захвата.
CREATE TABLE IF NOT EXISTS capture_liveness (
    liveness_id BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id   SMALLINT    NOT NULL REFERENCES data_source (source_id),
    from_ts     TIMESTAMPTZ NOT NULL,
    to_ts       TIMESTAMPTZ NOT NULL,
    open        BOOLEAN     NOT NULL DEFAULT true, -- true = интервал ещё продлевается хартбитом
    CONSTRAINT ck_capture_liveness_span CHECK (to_ts >= from_ts)
);

-- Выборка интервалов живости по источнику в окне Ганта.
CREATE INDEX IF NOT EXISTS ix_capture_liveness_source_from
    ON capture_liveness (source_id, from_ts);

-- Инвариант: не более одного открытого интервала на source.
CREATE UNIQUE INDEX IF NOT EXISTS uq_capture_liveness_open
    ON capture_liveness (source_id) WHERE open;
