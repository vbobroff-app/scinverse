-- Phase 7j (история расписаний рынков MOEX). Курируемая ВЕРСИОННАЯ история торгового распорядка
-- ПО ДВИЖКУ (futures/stock/currency), а не по инструменту. Смысл: Гант рисует историческую колбаску
-- по расписанию, ДЕЙСТВОВАВШЕМУ на дату этого дня, а не по «текущему» из ISS. Меняется редко
-- (единицы событий: ДСВД c 2025, ЕТС-переход, расширение СР 14.07.2026), поэтому строк немного и
-- наполняем их вручную/исследовательски. Действующая версия на дату D = строка с
-- max(effective_from) <= D. ISS используем как ДЕТЕКТОР дрейфа (daily-sync), запись — курируемая.
--
-- Часы — МСК (UTC+3, без DST). wd_* — будний день, we_* — выходной (ДСВД; NULL = в выходные не торгует).
-- Внешняя граница дня (wd_open/close) ВКЛЮЧАЕТ аукцион открытия — по ней рисуется колбаска.
-- Детальные фазы (утро/основная/вечер/аукцион/выходное окно) — в JSONB `phases` для будущих зон
-- [pre | session | post]; текущему рендеру достаточно внешних границ.
--
-- Достоверность (`confidence`): authoritative > empirical > assumed. Бэкфилл истории (5 лет под импорт
-- QScalp) — эмпирически по свечам ликвидных инструментов (Finam: RI/Si для СР, SBER для ФР): min/max
-- времени сделок = границы дня, «дыры» в минутных свечах = клиринговые перерывы → фазы; дата сдвига
-- времени = точный effective_from смены регламента. Это офлайн-research (кандидаты → ручная проверка →
-- вставка с confidence='empirical'); позже уточняется authoritative-строками. Даты/аномалии (праздники,
-- переносы, сокращённые) — из бесплатного ISS `dailytable` (есть история с 2018), это отдельный слой.
CREATE TABLE IF NOT EXISTS market_schedule (
    schedule_id    BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    engine         TEXT        NOT NULL,               -- futures | stock | currency (движок ISS)
    effective_from DATE        NOT NULL,               -- версия действует с этой даты (МСК)
    wd_open        TIME        NOT NULL,               -- будни: внешняя граница дня, старт (вкл. аукцион)
    wd_close       TIME        NOT NULL,               -- будни: внешняя граница дня, конец
    we_open        TIME,                               -- выходные (ДСВД): старт; NULL = не торгует
    we_close       TIME,                               -- выходные (ДСВД): конец
    phases         JSONB,                              -- детальные фазы (утро/основная/вечер/аукцион/ДСВД)
    -- Достоверность версии: authoritative (офиц. MOEX: новость/приказ/s1167/ISS session_schedule),
    -- empirical (реконструкция по свечам/сделкам — Finam RI/Si/SBER: границы + клиринговые перерывы),
    -- assumed (предположение/интерполяция). При уточнении добавляем строку с более высокой достоверностью.
    confidence     TEXT        NOT NULL DEFAULT 'assumed',
    source         TEXT,                               -- откуда взято (ссылка/описание): moex.com/n101980, «Finam candles Si 1m»
    note           TEXT,                               -- пояснение/контекст для курирования
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_market_schedule_engine_from UNIQUE (engine, effective_from),
    CONSTRAINT ck_market_schedule_confidence CHECK (confidence IN ('authoritative', 'empirical', 'assumed'))
);

-- Резолв «версия на дату»: WHERE engine=? AND effective_from <= D ORDER BY effective_from DESC LIMIT 1.
CREATE INDEX IF NOT EXISTS ix_market_schedule_lookup
    ON market_schedule (engine, effective_from DESC);

-- Сид: срочный рынок (FORTS, engine=futures). Две версии — «сегодня» и «с 14.07.2026».
INSERT INTO market_schedule (engine, effective_from, wd_open, wd_close, we_open, we_close, phases, confidence, source, note)
VALUES
    -- ДО ЕТС (регламент с ОТДЕЛЬНОЙ вечерней доп. сессией, отменённой 20.03.2026). Нижняя граница —
    -- старт ДСВД (доп. сессия выходного дня) 01.03.2025. Часы/фазы ПРЕДПОЛОЖИТЕЛЬНЫ (confidence=assumed):
    -- уточнить эмпирически по свечам Finam (RI/Si) — границы дня и клиринговые перерывы.
    ('futures', '2025-03-01', '08:50', '23:50', '09:50', '19:00',
     '{"auction":{"from":"08:50","till":"09:00"},"morning":{"from":"09:00","till":"10:00"},"main":{"from":"10:00","till":"19:00"},"evening":{"from":"19:00","till":"23:50"},"weekend":{"from":"10:00","till":"19:00"}}'::jsonb,
     'assumed', NULL,
     'Регламент СР до ЕТS (вечерняя как отдельная доп. сессия). Часы/фазы и нижняя граница даты — предположение, уточнить по свечам Finam RI/Si.'),

    -- Регламент СР после запуска ЕТС (Единая торговая сессия) 23.03.2026: аукцион 08:50,
    -- утро 09:00–10:00, основная 10:00–19:00, вечер 19:00–23:50. ДСВД: аукцион 09:50, торги 10:00–19:00.
    -- Контекст: 20.03.2026 отменена вечерняя доп. сессия СР, 23.03.2026 — запуск ЕТС (clck.ru/3Sbhm2).
    -- Регламент ДО 20.03.2026 (с вечерней доп. сессией) — добавим отдельной строкой при исследовании.
    ('futures', '2026-03-23', '08:50', '23:50', '09:50', '19:00',
     '{"auction":{"from":"08:50","till":"09:00"},"morning":{"from":"09:00","till":"10:00"},"main":{"from":"10:00","till":"19:00"},"evening":{"from":"19:00","till":"23:50"},"weekend":{"from":"10:00","till":"19:00"}}'::jsonb,
     'authoritative', 'clck.ru/3Sbhm2 (новость MOEX)',
     'Регламент СР после запуска ЕТС 23.03.2026 (20.03 отменена вечерняя доп. сессия).'),

    -- С 14.07.2026 (moex.com/n101980): расширение времени торгов СР, внешняя граница выровнена с ФР.
    -- Аукцион 06:50–07:00, утро 07:00–10:00, основная 10:00–19:00, вечер 19:00–23:50. ДСВД без изменений.
    ('futures', '2026-07-14', '06:50', '23:50', '09:50', '19:00',
     '{"auction":{"from":"06:50","till":"07:00"},"morning":{"from":"07:00","till":"10:00"},"main":{"from":"10:00","till":"19:00"},"evening":{"from":"19:00","till":"23:50"},"weekend":{"from":"10:00","till":"19:00"}}'::jsonb,
     'authoritative', 'moex.com/n101980 (новость MOEX)',
     'Расширение времени торгов СР с 14.07.2026 (06:50 старт).')
ON CONFLICT (engine, effective_from) DO NOTHING;
