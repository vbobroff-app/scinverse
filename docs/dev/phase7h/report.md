# Phase 7h. Отчёт о выполнении

Актуальный статус фазы 7h. Обновляется по мере выполнения задач из [plan.md](plan.md).

**Текущий статус:** `DONE`.
**Обновлено:** 2026-07-13.

## Статус задач

| #     | Задача | Статус | Комментарий |
| ----- | ------ | ------ | ----------- |
| 7h.0  | host: recovery осиротевших сегментов на старте (`V009`, `interrupted`) | DONE | `CoverageStore.RecoverOpenSegmentsAsync`; `ended_at` = GREATEST(last_trade, open liveness) |
| 7h.1  | storage: `capture_liveness` (`V010`/`V011`), `ICaptureLivenessStore` | DONE | heartbeat/split/close_reason/`QueryGapsAsync`; тесты зелёные |
| 7h.2  | host: `LivenessProbe` — хартбит 15 c + пинг в сессионной тишине | DONE | гейт: активная запись + торговые часы; вне сессии пинги **не** идут |
| 7h.3  | connector: непрерывный `server_status` + `ConnectorLinkState` | DONE | `TransaqConnector`, `SyntheticLiveConnector.InjectLinkState` |
| 7h.4  | host: автомат связи + ре-подписка + закрытие сегмента с причиной | DONE | `RecordingManager.OnLinkDownAsync` / `OnLinkLiveAsync` |
| 7h.5  | WS + core: `connectionStateChanged`, `/coverage/liveness`, `OhsStore` | DONE | refresh при WS-reconnect; `liveness$` + gaps на клиенте |
| 7h.6  | UI: честная подложка, красные разрывы, серый `stopped`, `degraded` | DONE | `CoverageTrack`, `ConnectionToggle`, тултипы причин |
| 7h.7  | эмуляция + тесты | DONE | `POST /connections/{id}/debug/drop`; seed SQL; api-тест reconnect |

## Критерии приёмки

| # | Критерий | Результат |
| - | -------- | --------- |
| 1 | Обрыв `server_status=false` закрывает сегмент и рвёт подложку (красная разметка) | ✅ Проверено на живом Finam/Transaq |
| 2 | Тихий рынок не рвёт подложку; пинг подтверждает Live | ✅ |
| 3 | Реконнект ре-подписывает; новый сегмент + сделки текут | ✅ |
| 4 | `connectionStateChanged` по WS; тумблер реагирует | ✅ |
| 5 | Эмуляция (synthetic / debug drop) воспроизводит путь | ✅ Api-тест `DebugDrop_synthetic_*`, `Connect_after_debug_drop_reconnects` |
| 6 | `tsc` + vitest + backend-тесты зелёные | ✅ |

## Лог выполнения

| Дата | Действие | Результат |
| ---- | -------- | --------- |
| 2026-07-11 | 7h.0–7h.1: recovery + `capture_liveness` + close_reason (`V011`) | фундамент в БД и сторе |
| 2026-07-12 | 7h.2–7h.3: `LivenessProbe`, непрерывный `server_status` | валидировано на Finam |
| 2026-07-12 | 7h.6 (частично): `coverageGeometry`, честная подложка ∩ живость, красные gaps | визуал «похоже на правду» |
| 2026-07-12 | 7h.4–7h.5: автомат, ре-подписка, `connectionStateChanged`, WS-reconnect refresh | коммит `b163b68` |
| 2026-07-12 | 7h.6–7h.7: degraded toggle, серый stopped, debug drop, тесты | коммит `01958db` |
| 2026-07-12 | Живой стенд: kill бэка → gaps → reconnect → 5 инструментов, общий разрыв по source | приёмка пользователем |
| 2026-07-13 | Документация: [incident.md](incident.md); fix reconnect после Down (осиротевшая сессия) | тумблер Finam после обрыва; `Connect_after_debug_drop_reconnects` |

## Ключевые артефакты

### Backend

- `LivenessProbe.cs`, `ILivenessWriter.cs` — хартбит и закрытие живости (гейт торговых часов)
- `ConnectionManager.HandleLinkStateAsync` + `ConnectAsync` (reconnect после Down)
- `RecordingManager.OnLinkDownAsync` / `OnLinkLiveAsync` — сегменты + ре-подписка
- `CaptureLivenessStore.cs`, `CoverageStore.RecoverOpenSegmentsAsync`
- `ConnectorLinkState`, `TransaqServerStatusParser`
- `POST /api/connections/{id}/debug/drop?seconds=N` (Development, synthetic)

### Frontend

- `coverageGeometry.ts` — пересечение намерение ∩ живость, gaps, `effectiveSegmentEndMs`
- `CoverageTrack.tsx` — честная подложка, красная штриховка, шов обрыва, серый `stopped`
- `ConnectionToggle` — фазы `degraded` / `error`; `cancelConnect` при зависшем connecting
- `OhsStore.connect` — timeout 35 с, `disconnected` → error; `refreshLiveness()`

### Документация

- [incident.md](incident.md) — таксономия инцидентов, таблицы, pipeline, визуализация, SQL

### Dev / вспомогательное (временное)

- `DevLocalTransaqCredentials.cs` — креды из `appsettings.Local.json` (помечено к удалению)
- `selectedInstrumentsStorage.ts` — звёздочки в `localStorage`
- `repair-segments-after-crash.sql` — опциональный SQL для старых данных
- `seed-capture-liveness-2026-07-11.sql` — ручной seed для визуальной проверки

## Пользовательские сценарии проверки

| # | Сценарий | Как | Ожидание |
| - | -------- | --- | -------- |
| 1 | Честная подложка | synthetic + запись | зелёная подложка ∩ намерение, ячейки сделок |
| 2 | Искусственный обрыв | `POST …/debug/drop?seconds=30` | красный gap, тумблер disconnected → recover |
| 3 | Тихий рынок | Finam в сессии, редкие сделки | подложка цела, ячеек нет — не красное |
| 4 | Реальный обрыв | выдернуть сеть 1–2 мин | общий gap по source на всех инструментах |
| 5 | Краш бэка | kill Host при записи | recovery `interrupted`, красный gap, без склейки до now |
| 6 | Конец сессии | запись до 19:00 МСК (выходной) | серая `stopped`, не красная штриховка |
| 7 | Вне сессии | connect + запись ночью/до открытия | **пинги не идут**, живость не открывается |
| 8 | Seed визуала | `seed-capture-liveness-2026-07-11.sql` | красная полоса ~17:45 МСК на Finam |

## Коммиты

| SHA | Сообщение |
| --- | --------- |
| `de49953` | feat(ohs-7h): liveness probe, link state, honest Gantt gaps |
| `b163b68` | feat(ohs-7h): link automaton, re-subscribe, connectionStateChanged WS |
| `01958db` | feat(ohs-7h): UI break styling, degraded toggle, debug drop |
| *(этот коммит)* | docs(ohs-7h): incident guide, reconnect fix, promt handoff 7i |

## Вне области (осталось на follow-up)

- Backfill непокрытых участков (phase 7c ISS / 9 qsh)
- Тонкая политика auto-reconnect / backoff сверх TXmlConnector
- Удаление dev-хелперов (`DevLocalTransaqCredentials`, local creds endpoint) после стабилизации стенда
- Персист порогов в `user_settings` (phase 10)

## Итог

Phase 7h **завершена**. Гант показывает три слоя (намерение ∩ живость + сделки), честно различает
**обрыв связи** (красная разметка) и **тихий рынок** (подложка есть, ячеек сделок нет). Автомат связи
закрывает сегменты при Down/Error, ре-подписывает при Live, пушит состояние на фронт.

**Важно для 7i:** `LivenessProbe` уже гейтит пинг/хартбит торговыми часами — вне сессии запись может
быть «включена» в RAM, но живость не пишется. Supervisor 7i должен **не вооружать** запись вне окна.

Следующий шаг — **[phase 7i](../phase7i/plan.md)** (расписание автозаписи / Supervisor).
