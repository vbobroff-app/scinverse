-- Phase 7i (расписание). Второй слой — ИСКЛЮЧЕНИЯ ПО ДАТЕ. Отклонения на конкретный день от базового
-- market_schedule: праздник (торгов нет), сдвиг часов, сокращённый день. Отдельная сущность (паттерн ISS
-- timetable vs dailytable); НИКОГДА не мутирует base. Обычно создаётся АВТО после сверки с внешним API
-- (Finam Schedule / ISS dailytable) перед арматурой записи; scope чаще всего = инструмент.
--
-- Дата — это один день (будни или выходной сами по себе), поэтому деления wd_*/we_* нет — только окно дня.
-- Scope-колонки те же, что в market_schedule (market/sec_type/category/instrument), NULL = wildcard.
-- Резолвер: apply(base, самая специфичная exception на дату). resolved — маркер «пользователь разобрал»
-- (анти-спам ежедневной сверки), НА РЕЗОЛВЕР НЕ ВЛИЯЕТ. См. docs/dev/phase7i/schedule.md.
CREATE TABLE IF NOT EXISTS market_schedule_exception (
    exception_id BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    exc_date     DATE        NOT NULL,               -- дата отклонения (МСК)
    market       TEXT        NOT NULL,               -- scope: derivatives | stock | currency
    sec_type     TEXT,                               -- scope (NULL = wildcard)
    category     TEXT,                               -- scope (NULL = wildcard)
    instrument   TEXT,                               -- SECID для точечного исключения (NULL = по scope)
    kind         TEXT        NOT NULL,               -- no_trade | shifted | shortened
    open_time    TIME,                               -- для shifted/shortened; NULL при no_trade
    close_time   TIME,                               -- для shifted/shortened; NULL при no_trade
    phases       JSONB,                              -- фазы этого дня (если сдвиг)
    confidence   TEXT        NOT NULL DEFAULT 'assumed',
    source       TEXT,                               -- 'ISS dailytable' | 'Finam Schedule' | 'user'
    resolved     BOOLEAN     NOT NULL DEFAULT FALSE, -- пользователь разобрал → сверка не спамит
    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_mse_kind       CHECK (kind IN ('no_trade', 'shifted', 'shortened')),
    CONSTRAINT ck_mse_confidence CHECK (confidence IN ('authoritative', 'empirical', 'assumed'))
);

-- Идемпотентность pre-flight: одно исключение на (scope + дата). NULL-wildcard требует COALESCE.
CREATE UNIQUE INDEX uq_mse_scope_date ON market_schedule_exception (
    market,
    COALESCE(sec_type,   ''),
    COALESCE(category,   ''),
    COALESCE(instrument, ''),
    exc_date
);

-- Резолв «исключения на дату»: WHERE market=? AND exc_date=? (scope-фильтр — в приложении).
CREATE INDEX ix_mse_lookup ON market_schedule_exception (market, exc_date);
