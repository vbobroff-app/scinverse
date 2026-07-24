-- Phase 7j.19 (I1): плановое отключение связи по авто-расписанию — отдельная причина закрытия,
-- чтобы НЕ путать его с ручным 'disconnected' («отключение оператором») на ленте Connection и в
-- контексте «пред. сеанс». Плановое отключение (Auto вне окна / non-trading) — не разрыв.
--   'scheduled' — плановое отключение по расписанию (ConnectionSupervisor, вне окна).
ALTER TABLE link_liveness
    DROP CONSTRAINT IF EXISTS link_liveness_close_reason_check;

ALTER TABLE link_liveness
    ADD CONSTRAINT link_liveness_close_reason_check
    CHECK (close_reason IN ('disconnected', 'server_down', 'ping_failed', 'interrupted', 'scheduled'));
