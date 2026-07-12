-- Починка осиротевших coverage_segment после краша OHS (dev-стенд).
-- Recovery до фикса 7h закрывал сегмент по последней СДЕЛКЕ, а не по последнему heartbeat.
-- Из-за этого красный разрыв не попадал в намерение (кроме инструментов с недавними сделками).
--
-- Запускать один раз после краша, если подложка/разрывы выглядят неправильно.
-- source_id=1 — transaq Finam.

UPDATE coverage_segment s
SET ended_at = GREATEST(
        s.ended_at,
        COALESCE(
            (SELECT max(cl.to_ts)
             FROM capture_liveness cl
             WHERE cl.source_id = s.source_id
               AND cl.close_reason = 'interrupted'
               AND cl.to_ts >= s.started_at),
            s.ended_at))
WHERE s.status = 'interrupted'
  AND s.source_id = 1;

-- Проверка: интервалы живости и разрывы
-- SELECT liveness_id, from_ts, to_ts, open, close_reason FROM capture_liveness WHERE source_id=1 ORDER BY from_ts;
-- SELECT to_ts AS gap_from, lead(from_ts) OVER (ORDER BY from_ts) AS gap_to, close_reason
-- FROM capture_liveness WHERE source_id=1 AND close_reason IN ('interrupted','server_down','ping_failed');
