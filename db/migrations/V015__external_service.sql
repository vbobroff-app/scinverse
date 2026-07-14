-- Phase 7i (Интеграции). Внешние сервисы = сущность ОТДЕЛЬНАЯ от коннекторов (connector_connection):
-- API request/response + JWT (on-demand), а не stream + Basic (подписка). Пользователь заводит их сам
-- в разделе «Интеграции». MVP-адаптер — finam (подтверждатель расписания, см. phase7i/schedule.md).
--
-- Секрет (tapi_sk_…) храним ЗДЕСЬ, в БД: он нужен авто-pre-flight без человека (в отличие от in-memory
-- кред коннектора). Пользователь один, прятать не от кого; после Keycloak (phase 10) — пересмотреть.
CREATE TABLE IF NOT EXISTS external_service (
    service_id        BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name              TEXT        NOT NULL UNIQUE,          -- свободное имя ("Finam REST API")
    adapter           TEXT        NOT NULL,                 -- биндинг на код: finam
    transport         TEXT        NOT NULL DEFAULT 'rest',  -- rest / grpc / ws
    secret            TEXT,                                 -- tapi_sk_… (может быть null до задания)
    secret_expires_on DATE,                                 -- advisory: предупреждаем об истечении
    enabled           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_external_service_transport CHECK (transport IN ('rest', 'grpc', 'ws'))
);
