-- Phase 7h: причина закрытия интервала живости → журнал разрывов. Разрыв = негативное пространство
-- между интервалами capture_liveness; чтобы у него была ПРИЧИНА, храним её на закрытии интервала:
--   'stopped'      — пользователь остановил запись (НЕ разрыв, намеренно);
--   'server_down'  — server_status=false/error (обрыв связи; to_ts = точное время события);
--   'ping_failed'  — тишина в сессии + активный пинг не прошёл («тихая смерть» DLL);
--   'interrupted'  — краш хоста / пропуск тиков; закрыто recovery на старте или split'ом хартбита.
-- Журнал разрывов вычисляется (lead по from_ts), отдельной таблицей НЕ дублируем.
ALTER TABLE capture_liveness
    ADD COLUMN close_reason TEXT NULL
    CHECK (close_reason IN ('stopped', 'server_down', 'ping_failed', 'interrupted'));

-- Инвариант: открытый интервал ещё продлевается (причины нет), закрытый — всегда с причиной.
ALTER TABLE capture_liveness
    ADD CONSTRAINT ck_capture_liveness_reason
    CHECK ((open AND close_reason IS NULL) OR (NOT open AND close_reason IS NOT NULL));
