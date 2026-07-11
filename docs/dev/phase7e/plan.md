# Phase 7e. Управление подключениями (Transaq) — admin frontend

Расширение phase 7 (админ-фронт): UI создания/редактирования коннектора и ввода учётных данных,
чтобы завести **Transaq**-подключение и запустить realtime-запись прямо из админки (сейчас
подключения приходят только из сидов `SampleData`). Дизайн Stage 1 — в [../apply.md](../apply.md);
детали — в [apply.md](apply.md); статус — в [report.md](report.md).

**Статус:** `PLANNED`. **Stage:** 1. **Зависимости:** phase 6b (control-plane: фабрика коннекторов,
креды, `connect/disconnect/test`), phase 7 (`ConnectionsPanel`, `OhsStore`).

## Мотивация

Бэкенд для подключений уже готов (phase 6b): REST `POST /connections` (upsert),
`PUT /connections/{id}/credentials`, `POST /connections/{id}/{connect|disconnect|test}`, фабрика
коннекторов (TRANSAQ + SyntheticLive), in-memory креды. На фронте этого нет: `ConnectionsPanel`
только показывает список, форм создания/редактирования и ввода кред нет. Фаза закрывает именно
UI-разрыв — «завести Transaq и подключиться в realtime» без сидов.

## Область (in scope)

- **7e.1 core: команды подключений.** В `OhsStore` — публичные методы `createConnection` /
  `updateConnection` (обёртка `api.upsertConnection` + merge в `connections$`), `setCredentials`
  (`api.setCredentials`), `testConnection` (`api.test`). Обновление `connections$` уже есть
  (`upsertConnection` приватный — переиспользуем).
- **7e.2 UI: форма подключения.** Кнопка «+ Подключение» в `ConnectionsPanel` → модалка/панель:
  поля `name`, `kind` (`transaq` | `synthetic`), `source` (из `sources$`), `settings` (JSON/поля
  под kind: для Transaq — host/port/DLL-путь и пр.), `enabled`. Редактирование существующего — та же
  форма с префиллом.
- **7e.3 UI: ввод учётных данных.** Отдельная форма (login/password) → `PUT …/credentials`
  (write-only, в БД не сохраняются). Доступна на карточке подключения (`ProviderCard`) и/или в форме.
- **7e.4 UI: realtime connect.** Кнопки «Подключить/Отключить/Тест» уже есть в `ProviderCard` —
  свести флоу: создать → ввести креды → «Подключить» → статус `connected` (WS), пошёл ингест.
- **7e.5 Тесты.** vitest на новые методы `OhsStore` (upsert/credentials/test → корректный вызов api
  и merge состояния); при необходимости — smoke api-теста на upsert+credentials.

## Вне области (out of scope)

- Хранение секретов в БД / vault — креды остаются in-memory (как в phase 6b).
- Мастер автозаполнения инструментов Transaq (справочник тянется отдельно, вне этой фазы).
- Валидация специфичных Transaq-настроек на клиенте сверх базовой (доверяем ответу `test`).

## Критерии приёмки

1. Из админки можно создать Transaq-подключение (форма), ввести логин/пароль, нажать «Подключить»
   и увидеть статус `connected` + живой ингест (колбаски растут).
2. Существующее подключение редактируется той же формой (префилл), «Тест» отражает результат.
3. Секреты не попадают в `connections$`/ответы API (проверка как в существующем api-тесте).
4. `tsc --noEmit` + `vitest` зелёные.

## Порядок

7e.1 → 7e.2 → 7e.3 → 7e.4 → 7e.5. Детали — в [apply.md](apply.md), статус — в [report.md](report.md).
