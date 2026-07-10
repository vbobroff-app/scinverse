-- Группировка деривативов (phase6c): базовый код всегда задан, underlying_id — best-effort.
-- underlying не всегда представлен строкой instrument (спот/индекс у фьючерса; фьючерс мог ещё
-- не прийти на момент прихода опциона), поэтому ослабляем NOT NULL и добавляем текстовый ключ.

ALTER TABLE derivative ALTER COLUMN underlying_id DROP NOT NULL;

ALTER TABLE derivative ADD COLUMN IF NOT EXISTS underlying_code TEXT;

-- Покрывает группировку уровня underlying и выборку серий по экспирации.
CREATE INDEX IF NOT EXISTS ix_derivative_group ON derivative (underlying_code, expiration);
