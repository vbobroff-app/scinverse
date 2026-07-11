# Phase 7e. Отчёт о выполнении

Актуальный статус фазы 7e. Обновляется по мере выполнения задач из [plan.md](plan.md).

**Текущий статус:** `IN PROGRESS`. **Обновлено:** 2026-07-10.

## Статус задач

| #    | Задача | Статус | Комментарий |
| ---- | ------ | ------ | ----------- |
| 7e.1 | backend: `POST /connections/validate` (проверка настроек+кредов без записи в БД) | DONE | `ConnectionManager.ValidateAsync`; требует рестарт Host |
| 7e.2 | core: `OhsStore.createConnection` = validate → upsert → setCredentials | DONE | не прошла проверка — в БД ничего не создаётся |
| 7e.3 | UI: единая форма создания с кредами (`ConnectionForm` + кнопка `+`) | DONE | login/password в попапе; убран чекбокс `Включено` (мёртвый флаг) |
| 7e.4 | UI: realtime connect | DONE | тумблер `ConnectionToggle` (серый→жёлтый→синий, error=красный); label слева, switcher справа |
| 7e.5 | UI: редактирование/удаление (ПКМ-меню, confirm) + backend `PUT`/`DELETE /connections/{id}` | DONE | контекстное меню: ✎ Редактировать / ✕ Удалить; удаление гасит сессию и чистит креды |
| 7e.6 | Тесты (vitest + опц. api-smoke) | TODO | tsc/lint чист; C# 0 ошибок CS; smoke на живом рынке — вручную |

## Лог выполнения

| Дата | Действие | Результат |
| ---- | -------- | --------- |
| 2026-07-10 | Заведена фаза 7e: план/apply/отчёт | документы готовы |
| 2026-07-10 | core-команды `saveConnection/setConnectionCredentials/testConnection` в `OhsStore` | tsc ok |
| 2026-07-10 | `ConnectionForm` + кнопка `+` в `ConnectionsPanel` | форма создания transaq/synthetic |
| 2026-07-10 | Форма кредов + кнопка «Проверить» на `ProviderCard` | флоу: создать → креды → проверить → подключить |
| 2026-07-10 | Кнопку «Подключить/Отключить» заменил на тумблер `ConnectionToggle` | 3 состояния цветом: disconnected(серый)→connecting(жёлтый, пульс)→connected(синий); error=красный; `OhsStore.connect` ставит оптимистичный `connecting` |
| 2026-07-10 | Пересборка флоу по фидбеку: убрал кнопку «Проверить» (системный сценарий) и креды с карточки; проверка теперь при создании | `POST /connections/validate` (Contracts собран, 0 ошибок); Host заблокирован запущенным процессом — нужен рестарт |
| 2026-07-10 | Креды перенёс в попап `ConnectionForm`; убрал чекбокс `Включено` (поле `enabled` в БД нигде не читается) | validate → upsert → setCredentials; ошибка проверки показывается в форме, подключение не создаётся |
| 2026-07-10 | В тумблере поменял местами label и switcher | label слева, switcher справа |
| 2026-07-10 | Редактирование/удаление подключения: ПКМ-меню (✎/✕) + `ConfirmDialog` при удалении | backend `PUT /connections/{id}` (update-by-id, в т.ч. переименование) + `DELETE /connections/{id}` (disconnect+clear creds+delete; FK-безопасно); `ConnectionForm` в режиме edit (креды опциональны = не менять); tsc/lint чист, C# 0 ошибок CS |

## Итог

_(заполняется по завершении фазы)_
