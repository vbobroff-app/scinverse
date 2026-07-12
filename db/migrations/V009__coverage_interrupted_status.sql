-- Phase 7h: честная подложка. Добавляем статусы закрытия сегмента:
--   'disconnected' — связь отвалилась (server_status=false) при активной записи;
--   'interrupted'  — процесс упал/убит, сегмент остался открытым (ended_at IS NULL) и был закрыт
--                    recovery-логикой на старте хоста (по времени последней сделки).
-- Отличаются от 'stopped' (сами остановили) и 'error' — для красной разметки обрывов на Ганте.
ALTER TABLE coverage_segment DROP CONSTRAINT IF EXISTS ck_coverage_status;
ALTER TABLE coverage_segment
    ADD CONSTRAINT ck_coverage_status
    CHECK (status IN ('recording', 'stopped', 'error', 'disconnected', 'interrupted'));
