-- Phase 7c.10: категоризация фьючерсов по классу базового актива («Группа контрактов», спец. MOEX s205).
-- Курируемый справочник asset_code → category, наполняемый ИЗ ISS по кнопке (без таймера):
--   рефреш собирает актуальные ASSETCODE FORTS-фьючерсов, авто-классифицирует (сид-карта s205 +
--   резолв спот-актива через /iss/securities), новые/неизвестные помечает confirmed=false («на проверку»).
-- Курирование (ручное подтверждение) не перезатирается авто-рефрешем. Питает динамические фильтры (7d).
CREATE TABLE IF NOT EXISTS futures_asset_class (
    asset_code   TEXT        PRIMARY KEY,                 -- ASSETCODE из ISS: Si, SBER, BR, IMOEX…
    category     TEXT        NOT NULL,                    -- index|shares|currency|rate|commodity|other
    subcategory  TEXT,                                    -- напр. oil|metals|agro для товаров
    title        TEXT,                                    -- человекочитаемое имя базового актива
    source       TEXT        NOT NULL DEFAULT 'iss_auto', -- seed | iss_auto | curated
    confirmed    BOOLEAN     NOT NULL DEFAULT FALSE,      -- прошло ручную проверку (курирование)
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_futures_asset_category
        CHECK (category IN ('index', 'shares', 'currency', 'rate', 'commodity', 'other'))
);

-- Выборка по категории (для фильтров/группировки).
CREATE INDEX IF NOT EXISTS ix_futures_asset_class_category
    ON futures_asset_class (category);
