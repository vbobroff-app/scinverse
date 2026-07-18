-- Phase 7j/11. Композитный «умный» источник расписания — интеграция «Scinverse API» (adapter scinverse):
-- фасад над Finam/ISS, который сам роутит запросы по capability/движку (cross-source). Заводим её как
-- отдельную интеграцию и эксклюзивно переносим на неё галку use_for_schedule (реализует давнюю идею
-- «capability → источник» через один фасад, не трогая схему). См. docs/dev/phase7i/schedule.md.
--
-- Идемпотентно: если scinverse уже заведён (напр. руками в UI) — не дублируем.
INSERT INTO external_service (name, adapter, transport, enabled, use_for_schedule)
SELECT 'Scinverse API', 'scinverse', 'rest', TRUE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM external_service WHERE adapter = 'scinverse');

-- Эксклюзивно переносим источник системного расписания на scinverse (частичный uniq-индекс требует,
-- чтобы одновременно был помечен ≤1 сервис): сначала снимаем со всех прочих, затем ставим на scinverse.
UPDATE external_service SET use_for_schedule = FALSE WHERE adapter <> 'scinverse';
UPDATE external_service SET use_for_schedule = TRUE  WHERE adapter = 'scinverse';
