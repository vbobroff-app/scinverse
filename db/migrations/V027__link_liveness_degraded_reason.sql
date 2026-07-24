-- Phase 7j.20 (J1): «Degraded» (server_status connected="true" recover="true" — TRANSAQ сам
-- восстанавливает линк к серверу) теперь тоже ИНЦИДЕНТ (дыра в данных), а не «живое» состояние.
-- Интервал link_liveness закрывается при входе в Degraded причиной 'degraded' → жёлтая дырка на ленте
-- Connection (владелец восстановления = TRANSAQ). Возврат в Live открывает новый интервал.
--   'degraded' — линк к серверу дёрнулся, TRANSAQ сам восстанавливает (recover=true); данных нет.
ALTER TABLE link_liveness
    DROP CONSTRAINT IF EXISTS link_liveness_close_reason_check;

ALTER TABLE link_liveness
    ADD CONSTRAINT link_liveness_close_reason_check
    CHECK (close_reason IN ('disconnected', 'server_down', 'ping_failed', 'interrupted', 'scheduled', 'degraded'));
