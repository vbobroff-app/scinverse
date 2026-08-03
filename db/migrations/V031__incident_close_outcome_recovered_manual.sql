-- Manual reconnect success (тумблер on при open break) → close_outcome = recovered_manual.
-- Без этого ResolveAsync падает на CHECK, NC уже resolved, journal остаётся recovering → второе закрытие.
ALTER TABLE incident DROP CONSTRAINT IF EXISTS incident_close_outcome_check;

ALTER TABLE incident
    ADD CONSTRAINT incident_close_outcome_check
    CHECK (close_outcome IS NULL OR close_outcome IN (
        'recovered',
        'recovered_manual',
        'abandoned_schedule',
        'abandoned_manual'
    ));
