# Phase 6c. Особенности реализации (backend)

Конкретные решения фазы 6c. Обзор — в [plan.md](plan.md), сложности-мотивация — в
[phase7/issue.md](../phase7/issue.md).

## 1. Миграция `V007__derivative_grouping.sql`

`derivative` из `V003` требует `underlying_id NOT NULL` (FK → `instrument`). На практике underlying
не всегда представлен строкой `instrument`:

- у **фьючерса** underlying — спот/индекс (USD/RUB, RTS-index), которого в каталоге OHS нет;
- у **опциона** underlying — конкретный фьючерс (может ещё не прийти на момент апсерта).

Поэтому:

```sql
ALTER TABLE derivative ALTER COLUMN underlying_id DROP NOT NULL;
ALTER TABLE derivative ADD COLUMN IF NOT EXISTS underlying_code TEXT;  -- базовый код для группировки (всегда задан)
CREATE INDEX IF NOT EXISTS ix_derivative_group ON derivative (underlying_code, expiration);
```

- `underlying_code` — стабильный текстовый ключ базового актива (напр. `Si`, `RI`, `BR`), выводится
  из кода **всегда** → на нём строится группировка (не зависит от наличия `underlying_id`).
- `underlying_id` — заполняется best-effort, когда удаётся сматчить фьючерс-инструмент (для опциона).

## 2. `DerivativeSpec` + `IDerivativeSpecParser` (проект `Connectors.Transaq`)

```csharp
public sealed record DerivativeSpec
{
    public required string UnderlyingCode { get; init; } // "Si"
    public required DateOnly Expiration { get; init; }
    public char? OptionType { get; init; }               // 'C'/'P'; null → фьючерс
    public decimal? Strike { get; init; }                // null → фьючерс
    public string? UnderlyingFuturesCode { get; init; }  // для опциона: код фьючерса ("SiU6")
}

public interface IDerivativeSpecParser
{
    bool TryParse(InstrumentKey key, string? secType, DateOnly asOf, out DerivativeSpec spec);
}
```

### Правила разбора кодов MOEX FORTS (эвристика — подтвердить live-захватом)

**Фьючерс** (`sec_type=FUT`), формат `<base><monthLetter><yearDigit>` (напр. `SiU6`):

- `base` — ведущие буквы (`Si`, `RI`, `BR`, `GD`…); это `UnderlyingCode`.
- `monthLetter` (фьючерсные): `F G H J K M N Q U V X Z` → месяцы 1..12.
- `yearDigit` — последняя цифра года; разворачиваем в ближайший будущий год относительно `asOf`
  (в пределах 10 лет).
- `Expiration` — по конвенции даём **3-й пятницу** месяца исполнения (детерминированно; точную дату
  уточним из `sec_info.mat_date`, см. issue). `OptionType/Strike = null`.

**Опцион** (`sec_type=OPT`), TRANSAQ-код вида `Si65000BS6A`:

- ведущие буквы → `UnderlyingCode` (`Si`).
- первая группа цифр → `Strike` (`65000`).
- буквенный маркер типа: `…S…` → PUT (`'P'`), `…G…` → CALL (`'C'`) *(эвристика по наблюдаемым кодам
  из скринов; подтвердить `sec_info.put_call`)*.
- цифра-год → как у фьючерса; `Expiration` — 3-я пятница месяца серии.
- `UnderlyingFuturesCode` — код фьючерса того же base и экспирации (для резолва `underlying_id`).

Если код не распознан — `TryParse` возвращает `false`, `derivative` не пишется (инструмент остаётся
в плоском каталоге). Никаких исключений в конвейер.

> Точные даты экспирации/тип опциона в проде берём из `sec_info` (`mat_date`, `put_call`), когда
> подтвердим теги живым захватом. До этого детерминированная эвристика достаточна для группировки.

## 3. `SecurityInfo` — новые (опциональные) поля

```csharp
public DateOnly? Expiration { get; init; }
public char?     OptionType { get; init; }
public decimal?  Strike { get; init; }
public string?   UnderlyingCode { get; init; }
public string?   UnderlyingFuturesCode { get; init; }
```

Заполняются в `ConnectorSession`/`InstrumentRegistry` через `IDerivativeSpecParser` (а не в самом
XML-парсере — разбор кодов это доменная логика ACL, отделяем от XML). Для не-деривативов — `null`.

## 4. Write-path: наполнение `derivative` (`InstrumentStore.UpsertAsync`)

После upsert `instrument` — если у `SecurityInfo` есть `UnderlyingCode` (т.е. дериватив):

```sql
-- резолв underlying_id: для опциона ищем фьючерс по коду (может отсутствовать → NULL)
INSERT INTO derivative (instrument_id, underlying_id, underlying_code, expiration, option_type, strike)
SELECT @instrumentId,
       (SELECT instrument_id FROM instrument WHERE ticker = @underlyingFut LIMIT 1),
       @underlyingCode, @expiration, @optionType, @strike
ON CONFLICT (instrument_id) DO UPDATE SET
    underlying_id   = COALESCE(EXCLUDED.underlying_id, derivative.underlying_id),
    underlying_code = EXCLUDED.underlying_code,
    expiration      = EXCLUDED.expiration,
    option_type     = EXCLUDED.option_type,
    strike          = EXCLUDED.strike;
```

- `underlying_id` best-effort: `NULL`, если фьючерс ещё не пришёл; `COALESCE` в апдейте не затирает
  ранее найденную ссылку.
- Порядок прихода не критичен: группировка работает по `underlying_code`; `underlying_id` — бонус для
  точных джойнов цепочки.

## 5. Read-model группировки

Домен (`InstrumentCatalog.cs`):

```csharp
public sealed record GroupQuery
{
    public required string Level { get; init; }   // "underlying" | "series"
    public string? UnderlyingCode { get; init; }   // для level=series
    public string? SecType { get; init; }          // FUT/OPT фильтр
    public string? Search { get; init; }
}

public sealed record InstrumentGroup
{
    public required string Key { get; init; }        // underlying_code | expiration (ISO)
    public required string Label { get; init; }
    public required int Count { get; init; }
    public DateOnly? Expiration { get; init; }
}
```

`IInstrumentStore.QueryGroupsAsync(GroupQuery, ct)` → `IReadOnlyList<InstrumentGroup>`.

SQL:

```sql
-- level=underlying
SELECT d.underlying_code AS Key, d.underlying_code AS Label, COUNT(*) AS Count
FROM derivative d JOIN instrument i USING (instrument_id)
WHERE (@secType IS NULL OR i.sec_type = @secType)
  AND (@search IS NULL OR i.ticker ILIKE @search)
GROUP BY d.underlying_code
ORDER BY d.underlying_code;

-- level=series (в рамках underlying)
SELECT to_char(d.expiration,'YYYY-MM-DD') AS Key,
       to_char(d.expiration,'YYYY-MM-DD') AS Label,
       COUNT(*) AS Count, d.expiration AS Expiration
FROM derivative d JOIN instrument i USING (instrument_id)
WHERE d.underlying_code = @underlyingCode
  AND (@secType IS NULL OR i.sec_type = @secType)
GROUP BY d.expiration ORDER BY d.expiration;
```

## 6. Фильтры листа (`InstrumentQuery` += `UnderlyingCode`, `Expiration`)

`QueryAsync` при заданных фильтрах джойнит `derivative`:

```sql
... FROM instrument i
    LEFT JOIN derivative d ON d.instrument_id = i.instrument_id
WHERE (@underlyingCode IS NULL OR d.underlying_code = @underlyingCode)
  AND (@expiration IS NULL OR d.expiration = @expiration)
  AND (... прежние фильтры ...)
```

Так лист страйков серии грузится существующим `GET /api/instruments?underlyingCode=Si&expiration=…`
(с пагинацией/поиском). `InstrumentCatalogItem` += `Strike`, `OptionType`, `Expiration` (для подписи
плашек в дереве).

## 7. Эндпоинты (`OhsEndpoints`, контракт `IOhsApi`)

- `GET /api/instruments/groups?level=underlying&secType=&q=` → `InstrumentGroupDto[]`.
- `GET /api/instruments/groups?level=series&underlyingCode=Si&secType=&q=` → `InstrumentGroupDto[]`.
- `GET /api/instruments` — добавлены query-параметры `underlyingCode`, `expiration` (ISO date).

`InstrumentGroupDto { key, label, count, expiration? }`.

## 8. Синтетический FORTS-набор (демо без TRANSAQ)

Расширяем `SampleData`/`SyntheticLiveConnector` опциональным FORTS-набором:

- 1 фьючерс `SiU6` (`board=FUT`, `sec_type=FUT`);
- недельная серия опционов на несколько страйков: `Si65000BS6A`/`Si65000BG6A` … (`board=FUT/OPT`,
  `sec_type=OPT`).

Коды подобраны так, чтобы `DerivativeSpecParser` их распознавал → дерево наполняется детерминированно.
Включается флагом (не ломает существующий SHARE-прогон).

## 9. Тесты

- **unit** `DerivativeSpecParserTests`: `SiU6`→FUT(Si, exp), `Si65000BS6A`→OPT(P,65000),
  `Si65000BG6A`→OPT(C,65000), `SBER`→false.
- **integration** `DerivativeStoreTests`: upsert FUT+OPT → строки `derivative` корректны;
  `QueryGroupsAsync(underlying)`/`(series)` возвращают ожидаемые counts; лист по `underlyingCode`.
- **api** `OhsApiTests`: `/api/instruments/groups` отдаёт группы на сид-данных.
