// DTO зеркалом Scinverse.Ohs.Contracts (camelCase JSON). См. docs/dev/phase7/apply.md.

export interface InstrumentDto {
  instrumentId: number;
  ticker: string;
  board: string;
  secType: string | null;
  shortName: string | null;
  name: string | null;
  minStep: number;
  decimals: number;
  active: boolean;
  recording: boolean;
  hasOptions: boolean;
  strike: number | null;
  optionType: string | null;
  expiration: string | null;
}

export interface InstrumentPage {
  items: InstrumentDto[];
  total: number;
  limit: number;
  offset: number;
}

/** Узел дерева каталога: серия опционов (экспирация) фьючерса. */
export interface InstrumentGroupDto {
  key: string;
  label: string;
  count: number;
  expiration: string | null;
  /** Нотификатор типа серии: W1..W5 | M1..M12 | Q1..Q4. */
  badge: string | null;
}

export interface InstrumentQueryParams {
  q?: string;
  board?: string;
  secType?: string;
  category?: string;
  onlyRecording?: boolean;
  /** Только инструменты, по которым есть хоть один сегмент записи (фильтр «Не пустые»). */
  nonEmpty?: boolean;
  /** Явный список инструментов (фильтр «Выделенные»); пусто/undefined — без фильтра. */
  instrumentIds?: number[];
  /** Биржи (коды: MOEX, …) — задел под мультибиржу; пусто/undefined — без фильтра. */
  exchanges?: string[];
  underlyingId?: number;
  expiration?: string;
  limit: number;
  offset: number;
}

/** Ключ динамической плашки-фильтра каталога (порядок = порядок добавления). */
export type FilterKey = 'instruments' | 'selection' | 'exchanges';

/** Условие плашки «Выбор» (комбинируются по И). */
export type SelectionCondition = 'recording' | 'nonEmpty' | 'selected';

export interface SourceDto {
  sourceId: number;
  code: string;
  name: string | null;
}

/** Торговая сессия MOEX: дата и границы (ISO со смещением +03:00 МСК). */
export interface SessionDto {
  date: string;
  start: string;
  end: string;
  weekend: boolean;
  /**
   * Границы торговой сессии внутри отображаемого дня `[start,end]` — только для режима
   * «Full + сессия»: полные сутки с подсветкой зон `[pre | session | post]`. Клиентское поле
   * (проставляется тайм-лайн-фильтром), бэкенд его не заполняет.
   */
  sessionStart?: string;
  sessionEnd?: string;
}

/** Границы покрытия данными (для таймфрейма All). */
export interface CoverageExtentDto {
  from: string | null;
  to: string | null;
}

/** Единица посессионных таймфреймов. */
export type TimeframeUnit = 'D' | 'W' | 'M' | 'Q' | 'Y';

/**
 * Выбранный горизонт Ганта.
 * - `sessions` — последние N сессий (D/W) или календарный сдвиг (M/Q/Y);
 * - `all` — от самого раннего сегмента покрытия;
 * - `range` — фиксированный диапазон дат (без live-сдвига).
 */
export type Timeframe =
  | { kind: 'sessions'; unit: TimeframeUnit; count: number; includeWeekends: boolean }
  | { kind: 'all' }
  | { kind: 'range'; from: string; to: string; includeWeekends: boolean };

/**
 * Окно показа внутри дня (тайм-лайн-фильтр):
 * - `full` — полные сутки 00:00–24:00 (кросс-биржевой нейтраль);
 * - `smart` — авто: одна биржа в выборке → её сессия, микс/ничего → полные сутки;
 * - `session` — сессия конкретной биржи по её сегодняшнему расписанию, спроецированная на историю;
 * - `custom` — пользовательское окно `[fromMin, toMin]` (минуты от полуночи МСК).
 * (`history`/`set` — дат-точные и пользовательские расписания — придут в phase 7c.)
 */
/**
 * Окно сессии внутри дня — взаимоисключающая группа тайм-лайн-фильтра:
 * `none` (сессия не выбрана), сессия биржи, пользовательское расписание t1–t2, `smart` (авто).
 */
export type SessionWindowMode =
  | { mode: 'none' }
  | { mode: 'smart' }
  | { mode: 'session'; exchange: string }
  | { mode: 'custom'; fromMin: number; toMin: number };

/**
 * Тайм-лайн-фильтр оси Ганта: какие дни недели показывать (0=вс..6=сб), полные ли сутки и какое
 * окно сессии. `fullDay` — независимый тумблер; в сочетании с выбранной сессией даёт режим
 * `[pre | session | post]` (видны внесессионные сделки + границы сессии). Применяется чисто на
 * клиенте (пере-проекция оси), одинаково ко всем строкам.
 */
export interface TimelineFilter {
  weekdays: ReadonlySet<number>;
  fullDay: boolean;
  session: SessionWindowMode;
}

/**
 * Стандарт времени отображения — единый на всю систему (ось, тултипы, подписи).
 * `offsetMin` — смещение от UTC в минутах (МСК = +180). Сессии бирж остаются
 * привязанными к своим ТЗ; меняется только форматирование при выводе.
 */
export interface DisplayTz {
  preset: 'utc' | 'msk' | 'custom';
  offsetMin: number;
}

export interface GapDto {
  from: string;
  to: string;
}

export interface CoverageSegmentDto {
  segmentId: number;
  instrumentId: number;
  sourceId: number;
  from: string;
  to: string | null;
  tradeCount: number;
  status: string;
  gaps: GapDto[];
}

/**
 * Присутствие сделок по бакетам (слой сделок на Ганте): старты непустых бакетов инструмента
 * (ISO). Качественно (была торговля или нет), без объёма. Разрыв = отсутствие бакета.
 */
export interface TradeActivityDto {
  instrumentId: number;
  buckets: string[];
}

/** Запрос присутствия сделок: окно + размер бакета (сек) + источник + список инструментов. */
export interface TradeActivityRequest {
  from: string;
  to: string;
  bucketSeconds: number;
  sourceId: number;
  instrumentIds: number[];
}

export interface RecordingDto {
  instrumentId: number;
  ticker: string;
  board: string;
  sourceId: number;
  connectionId: number;
  segmentId: number;
  startedAt: string;
  tradeCount: number;
}

export interface StartRecordingRequest {
  instrumentId: number;
  connectionId: number;
}

export interface ConnectionDto {
  connectionId: number;
  sourceId: number;
  name: string;
  kind: string;
  settings: string;
  enabled: boolean;
  status: string;
}

export interface UpsertConnectionRequest {
  sourceId: number;
  name: string;
  kind: string;
  settings: string;
  enabled: boolean;
}

export interface ConnectionCredentialsRequest {
  login: string;
  password: string;
}

/** Проверка настроек подключения без записи в БД (поднять коннектор и погасить). */
export interface ValidateConnectionRequest {
  kind: string;
  settings: string;
  login?: string;
  password?: string;
}

export interface ValidateConnectionResult {
  ok: boolean;
  message?: string | null;
}

// Структура биржи из MOEX ISS (раздел «Биржи → Структура»).

/** Движок (торговая система): stock/futures/currency/… */
export interface EngineDto {
  name: string;
  title: string;
}

/** Рынок движка (shares/forts/…). */
export interface MarketDto {
  name: string;
  title: string;
}

/** Режим торгов (борд) рынка. */
export interface BoardDto {
  boardId: string;
  title: string;
  isTraded: boolean;
}

/** Торгуемый инструмент борда (статика ISS). */
export interface IssSecurityDto {
  secId: string;
  shortName: string | null;
  name: string | null;
  minStep: number | null;
  lotSize: number | null;
  decimals: number | null;
  assetCode: string | null;
}

/** Класс базового актива фьючерса (справочник futures_asset_class) для группировки/фильтров. */
export interface FuturesAssetClassDto {
  assetCode: string;
  category: string;
  subcategory: string | null;
  title: string | null;
  source: string;
  confirmed: boolean;
}

/** Итог актуализации справочника классов из ISS: всего кодов, новых, не распознано. */
export interface AssetClassRefreshResultDto {
  total: number;
  inserted: number;
  unresolved: number;
}

// Live-события WebSocket `/ws` (дискриминатор — поле `type`).
export type LiveEvent =
  | { type: 'recordingStarted'; instrumentId: number; sourceId: number; connectionId: number; segmentId: number }
  | { type: 'recordingStopped'; instrumentId: number }
  | { type: 'coverageExtended'; instrumentId: number; sourceId: number; to: string; tradeCount: number }
  | { type: 'connectionStatusChanged'; connectionId: number; status: string };
