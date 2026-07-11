-- Кэш присутствия сделок по бакетам (слой сделок на Ганте покрытия): какие временны́е бакеты
-- содержат хотя бы одну сделку. Качественно (есть/нет), без объёма. Закрытые (полные прошлые)
-- дни неизменны (md_trade append-only) → кэшируем; текущий день считаем на лету.
--
-- Храним только НЕПУСТЫЕ бакеты. Чтобы отличать «не считали» от «посчитали, сделок нет»,
-- посчитанные (id, source, bucket_size, day) отмечаем в trade_activity_computed.
CREATE TABLE IF NOT EXISTS trade_activity_bucket (
    instrument_id BIGINT      NOT NULL REFERENCES instrument (instrument_id),
    source_id     SMALLINT    NOT NULL REFERENCES data_source (source_id),
    bucket_size   INTERVAL    NOT NULL,
    bucket_ts     TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (instrument_id, source_id, bucket_size, bucket_ts)
);

-- Маркеры посчитанных закрытых дней (в т.ч. пустых) на конкретный размер бакета.
CREATE TABLE IF NOT EXISTS trade_activity_computed (
    instrument_id BIGINT   NOT NULL REFERENCES instrument (instrument_id),
    source_id     SMALLINT NOT NULL REFERENCES data_source (source_id),
    bucket_size   INTERVAL NOT NULL,
    day           DATE     NOT NULL,
    PRIMARY KEY (instrument_id, source_id, bucket_size, day)
);
