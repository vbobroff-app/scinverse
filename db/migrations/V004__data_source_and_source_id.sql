-- Мультиисточник (Решение 3, вариант A): источник — свойство наблюдения, входит в PK факта.

-- Справочник источников данных (аналог market/board).
CREATE TABLE IF NOT EXISTS data_source (
    source_id SMALLINT PRIMARY KEY,
    code      TEXT NOT NULL UNIQUE,   -- 'transaq' / 'synthetic' / 'qscalp'
    name      TEXT
);

INSERT INTO data_source (source_id, code, name) VALUES
    (1, 'transaq',   'TRANSAQ Connector (Finam)'),
    (2, 'synthetic', 'Synthetic/demo generator'),
    (3, 'qscalp',    'QScalp .qsh history')
ON CONFLICT (source_id) DO NOTHING;

-- md_trade: добавляем source_id, бэкфиллим существующие (тестовые) строки как transaq.
ALTER TABLE md_trade ADD COLUMN IF NOT EXISTS source_id SMALLINT;
UPDATE md_trade SET source_id = 1 WHERE source_id IS NULL;
ALTER TABLE md_trade ALTER COLUMN source_id SET NOT NULL;

-- FK на справочник источников (md_trade — hypertable, ссылается на обычную таблицу: поддерживается).
ALTER TABLE md_trade
    ADD CONSTRAINT fk_md_trade_source FOREIGN KEY (source_id) REFERENCES data_source (source_id);

-- Пересобираем PK: source_id входит в ключ (провенанс + сохранение нахлёстов источников).
ALTER TABLE md_trade DROP CONSTRAINT pk_md_trade;
ALTER TABLE md_trade
    ADD CONSTRAINT pk_md_trade PRIMARY KEY (instrument_id, source_id, trade_no, ts);
