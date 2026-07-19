-- Phase 7j (пресеты расписания соединения). Спотовый ВАЛЮТНЫЙ рынок MOEX (движок ISS `currency`, SELT)
-- отсутствовал в market_schedule на уровне рынка → эндпоинт /exchanges/currency/schedule отдавал 404,
-- а чип «MOEX валютный» в поповере расписания был выключен (нет данных). Добавляем market-строку
-- (sec_type/category = NULL = дефолт рынка; специфичные инструменты уточняются под-scope строками).
--
-- Регламент (МСК): единая торговая сессия 07:00–23:50, технический перерыв 04:00–06:50. В выходные
-- валютный рынок и рынок драгметаллов НЕ торгует (we_* = NULL), кроме отдельных решений биржи о торгах
-- в конкретные нерабочие дни (моделируется исключениями market_schedule_exception, не базой).
-- Источник: moex.com/ru/tradingcalendar; график МосБиржи 2026 (finuslugi.ru/navigator).
-- ВНИМАНИЕ: валютные ДЕРИВАТИВЫ (фьючерсы/опционы на валютные пары) — это срочный рынок, они лежат
-- отдельными строками под market='derivatives' (см. V016/V019), а не здесь.
INSERT INTO market_schedule (market, sec_type, category, effective_from, wd_open, wd_close, we_open, we_close, phases, confidence, source, note)
VALUES
    ('currency', NULL, NULL, '2025-01-01', '07:00', '23:50', NULL, NULL,
     '{"main":{"from":"07:00","till":"23:50"}}'::jsonb,
     'authoritative', 'moex.com/ru/tradingcalendar; finuslugi.ru (график МосБиржи 2026)',
     'Валютный рынок MOEX (SELT): единая сессия 07:00–23:50 МСК, тех.перерыв 04:00–06:50; в выходные не торгует.')
ON CONFLICT (market, COALESCE(sec_type, ''), COALESCE(category, ''), COALESCE(instrument, ''), effective_from) DO NOTHING;
