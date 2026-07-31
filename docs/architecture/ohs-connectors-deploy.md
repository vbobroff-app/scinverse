# OHS: коннекторы и развёртывание (to-be)

> Решение 2026-07-30. Связано: [`concept.md`](../concept.md), [`ohs.md`](../ohs.md),
> [`c4/arch.md`](c4/arch.md), инциденты break — [`../dev/phase7j/incident.md`](../dev/phase7j/incident.md).
>
> **Статус:** зафиксировано как направление; код as-is — монолит Host + TRANSAQ DLL на Windows (dev).

---

## 1. Ограничение TRANSAQ

Живой поток MVP идёт через **TRANSAQ XML Connector** (`txmlconnector.dll`, P/Invoke).

| Факт | Следствие |
|------|-----------|
| DLL — нативный **Windows** PE | Процесс, который её **грузит**, на чистом Linux не работает |
| Linux-Docker / Ubuntu host | Не загрузит DLL «просто контейнером» |
| Wine в Linux-container | Не целевой prod |
| Вскрытие / переписывание DLL | **Нет** (лицензия Finam + чужой протокол) |

Док Finam: `request_timeout` в команде `connect` — таймаут на выполнение запроса; **дефолт 20 с**, если тег не задан; `session_timeout` > `request_timeout`. Мы задаём явно (`Transaq:RequestTimeoutSeconds`, рабочий дефолт **10** после приёмки на кабеле: cut→Degraded ~8 с вместо ~20).

На **VPN off** сокет рвётся сразу (RST) → `server_status` без ожидания таймаута. На **кабеле/Wi‑Fi** часто «тихий» обрыв → DLL молчит до `request_timeout`.

Короткие blip (1–2 с) DLL часто **не показывает** — для потоковых данных это слепая зона, если нет своего датчика пути или кросс-платформенного WS-коннектора.

---

## 2. Целевое развёртывание prod

```text
┌─────────────────────────────────────────────┐
│  Linux (Ubuntu)                             │
│  · OHS control-plane / API / WS (логика)    │
│  · Admin / Product UI                       │
│  · TimescaleDB (+ остальной data-plane)     │
│  · (позже) NC, Gateway, Keycloak            │
└───────────────┬─────────────────────────────┘
                │  агентский канал (gRPC/WS/TCP)
┌───────────────▼─────────────────────────────┐
│  Windows (маленький агент)                  │
│  · процесс только с txmlconnector.dll       │
│  · connect / subscribe / сырой XML → вверх  │
│  · без UI, без БД, без толстого Host        │
└───────────────┬─────────────────────────────┘
                │  TRANSAQ XML
                ▼
             Finam
```

**Смысл split:** Linux — основной runtime OHS; Windows — **только** то, что требует DLL. Не «весь OHS на Windows навсегда» и не «вскрыть DLL под Linux».

As-is (этот репозиторий, dev): Host + DLL в одном Windows-процессе — допустимо до выноса агента.

---

## 3. Следующая реализация: `IMarketConnector` Finam WS

Официальный кросс-платформенный канал (без DLL):

- Спека: [Finam Trade API (WebSocket) / AsyncAPI](https://api.finam.ru/docs/async-api/#introduction)
- `wss://api.finam.ru:443`, JSON, JWT
- Подписки: quotes / **trades** / order book / bars / orders
- Envelope: `DATA` / `ERROR` / `EVENT` (`HANDSHAKE_SUCCESS`, `CONNECTION_CLOSED`, …)

| | TRANSAQ (агент) | Finam WS (`finam-ws`) |
|--|-----------------|------------------------|
| Порт | `IMarketConnector` + XML ACL | тот же порт, JSON→канон |
| ОС | Windows-агент | **Linux / Docker** |
| Обрыв | `server_status` / `request_timeout` | drop WS / `CONNECTION_CLOSED` |
| У нас сейчас | live-сделки | HTTP Finam только для расписания (phase 7i) |

**План внедрения (следующая крупная работа по коннекторам, не текущий hotfix):**

1. Новый адаптер `kind = finam-ws` (или `finam`), фабрика рядом с `transaq` / `synthetic`.
2. Маппинг TRADES → существующий `TradeEvent` / write-path (batcher без смены канона).
3. Link-health: события WS + свой path-monitor; инциденты break — тот же journal/NC контракт.
4. Приёмка: полнота/лаг TRADES vs TRANSAQ alltrades, лимиты JWT, параллельный прогон.
5. Cutover prod-стрима на Linux; Windows-агент — запасной / миграционный путь.

HTTP `IFinamApi` (расписание) **не заменяет** стрим; WS — отдельный write-path коннектор.

---

## 4. Детект дыр (связь = данные)

Решение 2026-07-30 (после тестов кабеля/VPN и разбора вариантов QuickPath / NetworkChange).

### 4.1. TRANSAQ (as-is / Windows) — только DLL-таймаут

**Не выдумываем** параллельный NetworkChange / TCP-probe / QuickPath на эре TRANSAQ.

| | |
|--|--|
| Рычаг | `<request_timeout>10</request_timeout>` (`Transaq:RequestTimeoutSeconds`) |
| Сигнал | `server_status` → Degraded / Down |
| Латентность до ERROR | **~8 с** на soft-disconnect (кабель/Wi‑Fi); VPN часто сразу |
| Короткие 1–2 с | **сознательно не ловим** — DLL их часто не показывает |
| Уточнение границы | to-be по желанию: `openedAt = lastData` (сделки), не момент колбэка |

Vendor-дефолт Finam без тега = 20 с; 10 — принятый рабочий дефолт OHS.

### 4.2. Finam WebSocket API (`finam-ws`) — руки развязаны

Там детект **проще и честнее**, без чёрного ящика DLL:

- drop сокета / `CONNECTION_CLOSED` / ERROR envelope — сразу видно приложению;
- свой heartbeat / read-idle timeout на WS (секунды, под нас);
- Linux/Docker без Windows-only событий;
- short blip ловится на уровне клиента WS, не через `request_timeout` TRANSAQ.

QuickPath / path-monitor / «&lt;1 с до ERROR» — **откладываем до реализации `finam-ws`**, не плодим обходной контур вокруг DLL.

### Сводка

```text
TRANSAQ     request_timeout=10  →  ~8 с, короткие обрывы не цель
finam-ws    WS close / idle     →  свой быстрый детект (следующая эра)
```

---

## 5. Что сознательно не делаем

- Reverse-engineer / «переписать DLL под .so».
- Класть TRANSAQ DLL в Linux-container как целевой prod.
- Считать poll статуса с фронта ускорением break (фронт зеркалит Host; правда — на линке/данных).

---

## 6. Связь с C4 / фазами

- Component OHS: блок **Market Connector** остаётся портом `IMarketConnector`; реализации — TRANSAQ-агент и/или `finam-ws`.
- Вынос Windows-агента и `finam-ws` — отдельный этап после стабилизации break/NC; не блокирует текущий gate 11→12, но нужен до «OHS только на Ubuntu».
- Плечи break (TRANSAQ recover vs супервизор) для DLL — [`phase7j/incident.md`](../dev/phase7j/incident.md); для WS — те же роли, другие сигналы линка.
