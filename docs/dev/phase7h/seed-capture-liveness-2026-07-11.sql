-- Ручной seed живости захвата (11.07.2026, transaq source_id=1).
-- Время в UTC; МСК = UTC+3.
--
-- Общая шкала для всех инструментов на source:
--   Si-9.26 старт:     15:59:38 МСК (12:59:38 UTC)
--   RTS/SBRF старт:    ~16:01–16:03 МСК
--   Обрыв (все):       17:45:00 МСК (14:45:00 UTC)  server_down
--   Реконнект (все):   18:26:00 МСК (15:26:00 UTC)
--   Стоп сессии:       ~18:59:54 МСК (15:59:54 UTC) stopped
--
-- Si-9.26: сегмент с trade_count=0 — одна подложка с красным разрывом 17:45–18:26.

TRUNCATE capture_liveness;

INSERT INTO capture_liveness (source_id, from_ts, to_ts, open, close_reason) VALUES
  (1, '2026-07-11 12:59:38+00', '2026-07-11 14:45:00+00', false, 'server_down'),
  (1, '2026-07-11 15:26:00+00', '2026-07-11 15:59:54+00', false, 'stopped');

-- Сегмент Si-9.26 (SiU6, segment_id=49): растянуть до конца сессии.
UPDATE coverage_segment SET
  started_at = '2026-07-11 12:59:38.624254+00',
  ended_at   = '2026-07-11 15:59:54+00',
  status     = 'stopped'
WHERE segment_id = 49;
