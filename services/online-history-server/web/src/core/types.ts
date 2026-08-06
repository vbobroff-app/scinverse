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
  /** Observed scope: connectionId (catalog-basket-instruments). */
  connectionId?: number;
  underlyingId?: number;
  expiration?: string;
  limit: number;
  offset: number;
}

/** Ключ динамической плашки-фильтра каталога (порядок = порядок добавления). */
export type FilterKey = 'instruments' | 'selection' | 'exchanges' | 'baskets';

/** Набор Observed (static / system / dynamic). */
export interface BasketDto {
  basketId: number;
  connectionId: number;
  kind: 'static' | 'dynamic' | 'system' | string;
  name: string;
  systemId: string | null;
  enabled: boolean;
  patterns: string[] | null;
  secType: string | null;
  boardId: string | null;
  memberCount: number;
}

export interface UpsertBasketRequest {
  name: string;
  patterns: string[];
  secType?: string | null;
  boardId?: string | null;
  enabled?: boolean;
}

export interface BasketPreviewRequest {
  patterns: string[];
  secType?: string | null;
  boardId?: string | null;
}

/** Строка Available / preview в модалке набора. */
export interface AvailableInstrumentDto {
  instrumentId: number;
  ticker: string;
  board: string;
  secType: string | null;
  shortName?: string | null;
  name?: string | null;
  expiration?: string | null;
  lotSize?: number | null;
}

export interface AvailableInstrumentPage {
  items: AvailableInstrumentDto[];
  total: number;
  limit: number;
  offset: number;
}

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

/** Запрос WriteGap (recovery-красный на Writers Gantt). */
export interface WriteGapsRequest {
  connectionId: number;
  from: string;
  to: string;
  instrumentIds: number[];
}

/** Клип WriteGap: WriteHole ∩ desired. */
export interface WriteGapDto {
  instrumentId: number;
  sourceId: number;
  from: string;
  to: string;
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
  /**
   * Лента Connection (7j.20/J6): момент передачи владения инцидентом TRANSAQ→супервизор ВНУТРИ этой же
   * дырки — тело до него жёлтое (TRANSAQ), после красное (супервизор). Дырка одна (простой = [from, to]).
   * null/отсутствует — передачи не было.
   */
  escalatedAt?: string | null;
  /**
   * Край по окончании окна расписания / manual (не возврат в Live). Зелёный 1px не рисуем.
   */
  abandoned?: boolean;
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
  /** T — окно owner TRANSAQ (жёлтое ≤ T), сек. С Host `OhsOptions.LinkRecoverGraceSeconds`. */
  linkRecoverGraceSeconds?: number;
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

/** Элемент сводки пачки (user-summary + system batch): что именно применено/снято. */
export interface ScheduleComposeItemDto {
  kind: 'set' | 'canceled' | string;
  label: string;
  scheduleId?: number | null;
}

/** Атомарная пачка schedule-операций (Saga, всё-или-ничего): один запрос вместо N PUT/cancel + compose. */
export interface ScheduleBatchRequest {
  batchId: string;
  kind: 'cleared' | 'applied' | 'recreated';
  upserts: PutConnectionScheduleRuleRequest[];
  cancels: number[];
  items: ScheduleComposeItemDto[];
}

/** Итог атомарной пачки: применённые правила (со scheduleId) + перекрытые id. */
export interface ScheduleBatchResultDto {
  ok: boolean;
  applied: ConnectionScheduleRuleDto[];
  superseded: number[];
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
  /** Кто инициировал (материализовано бэком, phase 11.2): user | system. */
  interaction?: string | null;
  /** Контур: internal | external. */
  localization?: string | null;
  /** Отображаемое имя актора (снимок): «Оператор» / имя пользователя / сервис. */
  actorLabel?: string | null;
}

/** Строка журнала инцидентов (GET /api/incidents, phase 11.13). */
export interface IncidentDto {
  corrUid: string;
  module: string;
  type: string;
  status: string;
  closeOutcome?: string | null;
  openedAt: string;
  closedAt?: string | null;
  subject: string;
  severity: string;
  title: string;
  lastActivityAt: string;
  connectionId?: number | null;
  sourceId?: number | null;
  escalatedAt?: string | null;
  subtype?: string | null;
  owner?: string | null;
  payload?: string | null;
  /** (closedAt ?? now) − openedAt, мс. */
  durationMs: number;
  /** payload.resolvedBy — кто закрыл вручную. */
  resolvedBy?: string | null;
  /** payload.closeNote — комментарий оператора «Причина закрытия». */
  closeNote?: string | null;
  /** Soft-delete: скрыт из ribbon/NC; null = видим. */
  deletedAt?: string | null;
  deletedBy?: string | null;
}

export interface IncidentPage {
  items: IncidentDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface IncidentQueryParams {
  module?: string;
  status?: string;
  /** Мульти-статус (модалка); приоритетнее status. */
  statuses?: string[];
  type?: string;
  /** Мульти close_outcome: recovered / recovered_manual / abandoned_manual. */
  closeOutcomes?: string[];
  connectionId?: number;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  /** Включить soft-deleted строки (модалка журнала). */
  includeDeleted?: boolean;
}

export interface ResolveIncidentRequest {
  resolvedBy?: string | null;
  /** Комментарий оператора → payload.closeNote. */
  closeNote?: string | null;
}

export interface SoftDeleteIncidentRequest {
  deletedBy?: string | null;
}

export interface BackfillOpenIncidentsResultDto {
  adopted: number;
  skipped: number;
  failed: number;
  /** Open journal breaks, для которых создан artificial NC atom. */
  seeded?: number;
}

export interface BackfillRecentIncidentsResultDto {
  inserted: number;
  skipped: number;
  failed: number;
  from: string;
  to: string;
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

/** GET /connections/needs-operator — Auto×N stop + open break в окне расписания. */
export interface ConnectionNeedsOperatorDto {
  connectionId: number;
  label: string;
  reason: string;
  attempts: number;
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

/** Итог инвалидации in-memory каталога инструментов (POST /api/instruments/catalog/refresh). */
export interface InstrumentCatalogRefreshResultDto {
  invalidated: boolean;
  isFresh: boolean;
}

/** Запрос load ATM-окна опционов (POST /connections/{id}/load-options). */
export interface LoadOptionsRequest {
  futuresInstrumentId: number;
  expiration: string;
  force?: boolean;
}

/** Итог ensure/load OPT-окна. */
export interface LoadOptionsResultDto {
  loaded: boolean;
  skippedFresh: boolean;
  optCodesRequested: number;
  familiesFound: number;
  strikesFound: number;
  atmPrice: number | null;
  message: string;
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
    }
  | {
      type: 'incidentVisibilityChanged';
      corrUid: string;
      deleted: boolean;
      connectionId: number | null;
    };
