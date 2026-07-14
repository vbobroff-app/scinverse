-- Phase 7i (расписание, редизайн). Базовый слой market_schedule получает МОДЕЛЬ SCOPE — общую с будущей
-- таблицей исключений (V017). Раньше версионирование было только по движку (engine); теперь строка «висит»
-- на уровне (market, sec_type, category, instrument), где заполнены лишь те уровни, до которых спускается
-- правило, ниже — NULL (= «на всё внутри»). Резолвер берёт САМУЮ СПЕЦИФИЧНУЮ строку на дату.
-- Значения — КОДЫ (латиница), category совпадает с futures_asset_class.category; русские подписи — в UI.
-- См. docs/dev/phase7i/schedule.md.

-- 1) engine → market (рынок). Коды market намеренно отличаются от sec_type, чтобы «срочный рынок» и
--    «фьючерс» не схлопнулись в одно слово: futures(движок ISS) → derivatives(срочный рынок).
ALTER TABLE market_schedule RENAME COLUMN engine TO market;
UPDATE market_schedule SET market = 'derivatives' WHERE market = 'futures';

-- 2) Scope-колонки (per-market коды; NULL = wildcard). Без глобального CHECK — словари зависят от рынка.
ALTER TABLE market_schedule
    ADD COLUMN sec_type   TEXT,   -- вид: futures | options | shares | bonds …  (NULL = любой)
    ADD COLUMN category   TEXT,   -- класс БА (как в futures_asset_class): currency|shares|index|rate|commodity|other
    ADD COLUMN instrument TEXT;   -- SECID (NULL = не привязано; для уникальных, напр. новый BTC-фьюч)

-- 3) Уникальность и резолв-индекс с учётом scope (NULL-wildcard требует COALESCE-выражения).
ALTER TABLE market_schedule DROP CONSTRAINT IF EXISTS uq_market_schedule_engine_from;
DROP INDEX IF EXISTS ix_market_schedule_lookup;

CREATE UNIQUE INDEX uq_market_schedule_scope_from ON market_schedule (
    market,
    COALESCE(sec_type,   ''),
    COALESCE(category,   ''),
    COALESCE(instrument, ''),
    effective_from
);
CREATE INDEX ix_market_schedule_lookup ON market_schedule (market, effective_from DESC);

-- 4) Валютные фьючерсы НЕ торгуются в выходные (ДСВД их не касается) — структурное правило, поэтому
--    базовыми строками уровня (derivatives, futures, currency) с we_* = NULL. Специфичнее общей строки
--    фьючерсов → резолвер выберет их для валютных контрактов. По одной на каждую версию регламента,
--    чтобы историческая отрисовка (Гант/бэкфилл) была корректной. Источник: moex.com/derivatives/weekend-session.
INSERT INTO market_schedule (market, sec_type, category, effective_from, wd_open, wd_close, we_open, we_close, phases, confidence, source, note)
VALUES
    ('derivatives', 'futures', 'currency', '2025-03-01', '08:50', '23:50', NULL, NULL,
     '{"auction":{"from":"08:50","till":"09:00"},"morning":{"from":"09:00","till":"10:00"},"main":{"from":"10:00","till":"19:00"},"evening":{"from":"19:00","till":"23:50"}}'::jsonb,
     'authoritative', 'moex.com/derivatives/weekend-session',
     'Валютные фьючерсы не торгуют в выходные (ДСВД). Будни — как общий регламент СР до ЕТС.'),

    ('derivatives', 'futures', 'currency', '2026-03-23', '08:50', '23:50', NULL, NULL,
     '{"auction":{"from":"08:50","till":"09:00"},"morning":{"from":"09:00","till":"10:00"},"main":{"from":"10:00","till":"19:00"},"evening":{"from":"19:00","till":"23:50"}}'::jsonb,
     'authoritative', 'moex.com/derivatives/weekend-session',
     'Валютные фьючерсы не торгуют в выходные. Будни — регламент СР после ЕТС (23.03.2026).'),

    ('derivatives', 'futures', 'currency', '2026-07-14', '06:50', '23:50', NULL, NULL,
     '{"auction":{"from":"06:50","till":"07:00"},"morning":{"from":"07:00","till":"10:00"},"main":{"from":"10:00","till":"19:00"},"evening":{"from":"19:00","till":"23:50"}}'::jsonb,
     'authoritative', 'moex.com/derivatives/weekend-session',
     'Валютные фьючерсы не торгуют в выходные. Будни — расширенный регламент СР с 14.07.2026 (старт 06:50).');
