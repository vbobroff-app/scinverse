-- Phase 7i (Интеграции). Назначение confirmer'а системного расписания. Из всех интеграций РОВНО ОДНА
-- может быть помечена источником, которому доверяет авто-сверка расписания (pre-flight). Это capability
-- «schedule»: сейчас — булев флаг, позже (per-market) вынесем в маппинг system_source(capability, market,
-- service_id). См. docs/dev/phase7i/schedule.md. Галка в UI: Интеграции → сервис → Расписание.
ALTER TABLE external_service
    ADD COLUMN use_for_schedule BOOLEAN NOT NULL DEFAULT FALSE;

-- Эксклюзивность: не более одной интеграции-источника расписания одновременно.
CREATE UNIQUE INDEX uq_external_service_schedule_source
    ON external_service ((use_for_schedule)) WHERE use_for_schedule;
