# Phase 6c. Иерархия инструментов: деривативы + группировка (backend)

Разблокирует «древовидный» каталог для phase7. Мотивация и список сложностей — в
[phase7/issue.md](../phase7/issue.md). Подход — **гибрид**: плоская модель `instrument`,
иерархия через атрибуты `derivative` (`underlying → series(expiration) → strike`) и read-model
группировки; дерево — это представление на фронте (phase7).

**Статус:** `PLANNED`. **Stage:** 1. **Зависимости:** phase6a/6b (схема, control-plane).

## Цели

1. Наполнять таблицу `derivative` (заложена в `V003`, сейчас пустая) на write-path.
2. Дать read-модель для ленивого дерева: узлы `underlying` и `series`, лист — существующая
   пагинация с фильтром по группе.
3. Обеспечить демонстрируемость без TRANSAQ (синтетический FORTS-набор).

## Область (in scope)

- **6c.1 Спецификация деривативов.** `IDerivativeSpecParser` + `DerivativeSpec`
  (underlyingCode, expiration, strike, optionType). Разбор кодов MOEX FORTS из тикера/шортнейма.
- **6c.2 `SecurityInfo` расширение.** Опциональные `Expiration`, `OptionType`, `Strike`,
  `UnderlyingCode` (заполняются парсером/`sec_info`; для не-деривативов — `null`).
- **6c.3 Write-path.** В `InstrumentStore.UpsertAsync` при `sec_type ∈ {FUT, OPT}` писать строку
  `derivative` (резолв `underlying_id` по коду; best-effort — см. apply про порядок прихода).
- **6c.4 Read-model группировки.** `IInstrumentStore.QueryGroupsAsync(GroupQuery)` +
  `GET /api/instruments/groups?level=underlying|series&underlyingId=&secType=&q=`.
- **6c.5 Фильтры листа.** `InstrumentQuery` += `UnderlyingId`, `Expiration` → лист страйков
  грузится существующим `GET /api/instruments`.
- **6c.6 Синтетический FORTS.** Демо-набор (1 базовый актив + фьючерс + недельная серия опционов)
  для проверки дерева без коннектора.
- **6c.7 Тесты.** unit (парсер кодов), integration (группировка/наполнение `derivative`), api
  (эндпоинт групп).

## Вне области (out of scope)

- Реальный `sec_info`-поток TRANSAQ с подтверждёнными тегами (`mat_date/put_call`) — спецификация
  закладывается, но точные теги подтверждаются live-захватом позже (см. issue п.4).
- Точный «статус торговой сессии» (`sec_status`) — отдельный инкремент (issue п.6).
- UI-дерево — это phase7 (возврат после 6c).

## Критерии приёмки

1. Для FORTS-инструментов (реальных или синтетических) `derivative` заполняется: у фьючерса —
   `expiration` (+ self `underlying_id`), у опциона — `expiration/strike/option_type` и
   `underlying_id` указывает на фьючерс.
2. `GET /api/instruments/groups?level=underlying` возвращает базовые активы с counts;
   `?level=series&underlyingId=…` — серии (по `expiration`) с counts.
3. `GET /api/instruments?underlyingId=…&…` отдаёт лист страйков серии (пагинировано).
4. Парсер кодов покрыт unit-тестами (фьючерс + PUT/CALL опционы + не-дериватив).
5. `dotnet build` 0/0; unit/integration/api тесты зелёные (добавлены новые).
6. Синтетический прогон показывает непустое дерево.

## Порядок

6c.1 → 6c.2 → 6c.3 → (6c.4 ∥ 6c.5) → 6c.6 → 6c.7. Детали реализации — в [apply.md](apply.md),
статус — в [report.md](report.md).
