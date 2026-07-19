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
  /** Базовый фьючерс опциона; null у не-OPT. Нужен для spine «Выделенные». */
  underlyingId?: number | null;
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
  /**
   * Scope «Выбор»: подтягивать БА-предков совпавших опционов (`true` = «ко всем»).
   * `false` = только верхний уровень (БА).
   */
  includeOptionAncestors?: boolean;
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

/** Область применения условий «Выбор»: ко всем инструментам или только к БА. */
export type SelectionScope = 'all' | 'base';

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

export interface LivenessIntervalDto {
  from: string;
  to: string;
  open: boolean;
  closeReason: string | null;
}

export interface CaptureGapDto {
  from: string;
  to: string | null;
  cause: string;
}

export interface LivenessQueryRequest {
  from: string;
  to: string;
  sourceId: number;
}

export interface CaptureLivenessDto {
  intervals: LivenessIntervalDto[];
  gaps: CaptureGapDto[];
}

/**
 * Жизненный цикл связи + периоды «связь не жива» на подключение (source) — лента Connection (phase 7h.8).
 * `intervals` = «связь жива» (зелёное), `gaps` = «не жива»; cause `disconnected` — серый (не разрыв),
 * `server_down/ping_failed/interrupted` — красный.
 */
export interface LinkLivenessDto {
  intervals: LivenessIntervalDto[];
  gaps: CaptureGapDto[];
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

/** Политика автозаписи инструмента (phase 7i). */
export interface RecordingScheduleDto {
  instrumentId: number;
  connectionId: number;
  autoEnabled: boolean;
}

export interface UpsertRecordingScheduleRequest {
  items: RecordingScheduleDto[];
}

/** Правило расписания соединения (phase 7j v2). Окно = open + durationMin, принадлежит дню открытия. */
export interface ConnectionScheduleRuleDto {
  scheduleId: number;
  connectionId: number;
  scopeKind: 'main' | 'dow' | 'date' | string;
  dowMask: number | null;
  dateFrom: string | null;
  dateTo: string | null;
  mode: 'window' | 'off' | string;
  open: string | null;
  durationMin: number | null;
  end: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  closeReason: 'superseded' | 'canceled' | string | null;
  changeSource: string;
  changeNote: string | null;
}

/** Настройки расписания уровня соединения (Auto / ведущий календарь / tz). */
export interface ConnectionScheduleSettingsDto {
  connectionId: number;
  autoEnabled: boolean;
  engine: string;
  tz: string;
}

/** Состояние расписания соединения: настройки + все живые правила. */
export interface ConnectionScheduleStateDto {
  settings: ConnectionScheduleSettingsDto;
  rules: ConnectionScheduleRuleDto[];
}

/** PUT правила (upsert со SCD-2 + авто-ретайр вложенных того же уровня). */
export interface PutConnectionScheduleRuleRequest {
  scopeKind: string;
  dowMask?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  mode: string;
  open?: string | null;
  durationMin?: number | null;
  changeSource?: string;
  changeNote?: string | null;
}

/** PUT настроек расписания соединения. */
export interface PutConnectionScheduleSettingsRequest {
  autoEnabled?: boolean;
  engine?: string;
  tz?: string;
}

export interface NotificationDto {
  id: string;
  ts: string;
  severity: string;
  sourceType: string;
  module: string;
  code: string;
  message: string;
  /** Жизненный цикл инцидента (ось B): active | underway | resolved; null ⇒ active. */
  status?: string | null;
  /** Ключ инцидента для upsert перехода статуса (группировка событий). */
  correlationId?: string | null;
  data?: unknown;
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

/** ВРЕМЕННО (dev): креды Transaq из appsettings.Local.json для префилла формы. */
export interface TransaqLocalDefaultsDto {
  login: string | null;
  password: string | null;
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
  /** Дата экспирации (ISS LASTTRADEDATE, `YYYY-MM-DD`); null для бессрочных/неприменимо. */
  expiration: string | null;
  /** Тип бумаги ISS (SECTYPE). */
  secType: string | null;
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

/** Вид дня торгового календаря движка. */
export type CalendarDayKind = 'regular' | 'transfer' | 'dsvd' | 'weekend' | 'holiday';

/**
 * День торгового календаря движка (бесплатный `/iss/engines/{engine}`): торговый ли день, его вид
 * и внешние часы (МСК, `HH:mm:ss`; заполнены только у торгового дня). `date` — `yyyy-MM-dd`.
 */
export interface CalendarDayDto {
  date: string;
  isTrading: boolean;
  weekend: boolean;
  exception: boolean;
  kind: CalendarDayKind;
  open: string | null;
  close: string | null;
}

/** Достоверность версии расписания. */
export type ScheduleConfidence = 'authoritative' | 'empirical' | 'assumed';

/** Фаза торгового дня расписания движка: ключ + границы (МСК, `HH:mm:ss`). */
export interface SchedulePhaseDto {
  key: string;
  from: string;
  till: string;
}

/**
 * Действующая версия торгового распорядка движка (курируемая `market_schedule`): внешние границы
 * будней/выходных + разложенные фазы (будни/ДСВД). Время — `HH:mm:ss` МСК; `effectiveFrom` — `yyyy-MM-dd`.
 */
export interface MarketScheduleDto {
  engine: string;
  effectiveFrom: string;
  wdOpen: string;
  wdClose: string;
  weOpen: string | null;
  weClose: string | null;
  weekday: SchedulePhaseDto[];
  weekend: SchedulePhaseDto[];
  confidence: ScheduleConfidence;
  source: string | null;
  note: string | null;
}

/** Тип отклонения исключения расписания. */
export type ScheduleExceptionKind = 'no_trade' | 'shifted' | 'shortened';

/**
 * Исключение расписания на дату (`market_schedule_exception`): отклонение от базы на конкретный день.
 * scope-поля заполнены до уровня отклонения (null = «на всё внутри»). Окно (`openTime`/`closeTime`,
 * `HH:mm:ss` МСК) — только для shifted/shortened. `resolved` — пользователь разобрал.
 */
export interface MarketScheduleExceptionDto {
  excDate: string;
  market: string;
  secType: string | null;
  category: string | null;
  instrument: string | null;
  kind: ScheduleExceptionKind;
  openTime: string | null;
  closeTime: string | null;
  confidence: ScheduleConfidence;
  source: string | null;
  resolved: boolean;
  note: string | null;
}

/** Транспорт внешнего сервиса. */
export type IntegrationTransport = 'rest' | 'grpc' | 'ws';

/**
 * Внешний сервис-интеграция (external_service, phase 7i). Секрет наружу не отдаётся — только признак
 * `hasSecret` и (advisory) дата истечения. `adapter` = биндинг на код (`finam`).
 */
export interface ExternalServiceDto {
  serviceId: number;
  name: string;
  adapter: string;
  transport: IntegrationTransport;
  hasSecret: boolean;
  secretExpiresOn: string | null;
  enabled: boolean;
  /** Назначен источником системного расписания (confirmer). Эксклюзивно: ≤1 интеграции. */
  useForSchedule: boolean;
}

/** Создание/обновление интеграции. `secret` пустой → не менять (при обновлении). */
export interface UpsertExternalServiceRequest {
  name: string;
  adapter: string;
  transport: IntegrationTransport;
  secret: string | null;
  secretExpiresOn: string | null;
  enabled: boolean;
}

/** Результат health-check интеграции (auth по сохранённому секрету). */
export interface IntegrationProbeResultDto {
  ok: boolean;
  message: string;
}

/** Сессия внешнего расписания: тип + границы окна (UTC ISO). */
export interface ExternalSessionDto {
  type: string;
  start: string;
  end: string;
}

/** Расписание инструмента у внешнего сервиса (Finam): символ + сессии. */
export interface ExternalScheduleDto {
  symbol: string;
  sessions: ExternalSessionDto[];
}

/** День внешнего календаря (ISS dailytable): дата, торговый ли, исключение и часы (МСК ISO). */
export interface ExternalCalendarDayDto {
  date: string;
  isTradingDay: boolean;
  isException: boolean;
  open: string | null;
  close: string | null;
}

/** Торговый календарь движка у внешнего сервиса (ISS): движок + дни диапазона. */
export interface ExternalCalendarDto {
  engine: string;
  days: ExternalCalendarDayDto[];
}

// Live-события WebSocket `/ws` (дискриминатор — поле `type`).
export type LiveEvent =
  | { type: 'recordingStarted'; instrumentId: number; sourceId: number; connectionId: number; segmentId: number }
  | { type: 'recordingStopped'; instrumentId: number }
  | { type: 'coverageExtended'; instrumentId: number; sourceId: number; to: string; tradeCount: number }
  | { type: 'connectionStatusChanged'; connectionId: number; status: string }
  | {
      type: 'connectionStateChanged';
      connectionId: number;
      state: string;
      since: string;
      reason: string | null;
    }
  | {
      type: 'recordingScheduleChanged';
      items: RecordingScheduleDto[];
    }
  | {
      type: 'notification';
      notification: NotificationDto;
    };
