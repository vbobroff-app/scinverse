import { ajax } from 'rxjs/ajax';
import { map, type Observable } from 'rxjs';
import type {
  AssetClassRefreshResultDto,
  BoardDto,
  CalendarDayDto,
  MarketScheduleDto,
  MarketScheduleExceptionDto,
  ConnectionCredentialsRequest,
  ConnectionDto,
  ConnectionScheduleDto,
  PutConnectionScheduleRequest,
  NotificationDto,
  CaptureLivenessDto,
  LinkLivenessDto,
  CoverageExtentDto,
  CoverageSegmentDto,
  EngineDto,
  ExternalCalendarDto,
  ExternalScheduleDto,
  ExternalServiceDto,
  FuturesAssetClassDto,
  IntegrationProbeResultDto,
  InstrumentGroupDto,
  InstrumentPage,
  InstrumentQueryParams,
  LivenessQueryRequest,
  IssSecurityDto,
  MarketDto,
  RecordingDto,
  SessionDto,
  SourceDto,
  StartRecordingRequest,
  TradeActivityDto,
  TradeActivityRequest,
  TransaqLocalDefaultsDto,
  UpsertConnectionRequest,
  UpsertExternalServiceRequest,
  UpsertRecordingScheduleRequest,
  RecordingScheduleDto,
  ValidateConnectionRequest,
  ValidateConnectionResult,
} from './types';

const BASE = '/api';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function getJSON<T>(path: string): Observable<T> {
  return ajax.getJSON<T>(`${BASE}${path}`);
}

function buildInstrumentsQuery(params: InstrumentQueryParams): string {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.board) search.set('board', params.board);
  if (params.secType) search.set('secType', params.secType);
  if (params.category) search.set('category', params.category);
  if (params.onlyRecording) search.set('onlyRecording', 'true');
  if (params.nonEmpty) search.set('nonEmpty', 'true');
  if (params.instrumentIds?.length) search.set('instrumentIds', params.instrumentIds.join(','));
  if (params.includeOptionAncestors === false) search.set('includeOptionAncestors', 'false');
  if (params.exchanges?.length) search.set('exchanges', params.exchanges.join(','));
  if (params.underlyingId != null) search.set('underlyingId', String(params.underlyingId));
  if (params.expiration) search.set('expiration', params.expiration);
  search.set('limit', String(params.limit));
  search.set('offset', String(params.offset));
  return `?${search.toString()}`;
}

function post<T>(path: string, body?: unknown): Observable<T> {
  return ajax<T>({ url: `${BASE}${path}`, method: 'POST', headers: JSON_HEADERS, body }).pipe(
    map((r) => r.response),
  );
}

function put<T>(path: string, body?: unknown): Observable<T> {
  return ajax<T>({ url: `${BASE}${path}`, method: 'PUT', headers: JSON_HEADERS, body }).pipe(
    map((r) => r.response),
  );
}

/**
 * Тонкий типизированный клиент OHS REST API (RxJS). Все методы возвращают Observable;
 * base-префикс `/api` проксируется Vite на живой хост (см. vite.config.ts).
 */
export const OhsApi = {
  getInstruments: (params: InstrumentQueryParams) =>
    getJSON<InstrumentPage>(`/instruments${buildInstrumentsQuery(params)}`),

  getInstrumentSeries: (underlyingId: number) =>
    getJSON<InstrumentGroupDto[]>(`/instruments/groups?level=series&underlyingId=${underlyingId}`),

  getSources: () => getJSON<SourceDto[]>('/sources'),
  getConnections: () => getJSON<ConnectionDto[]>('/connections'),
  getRecordings: () => getJSON<RecordingDto[]>('/recordings'),

  getCoverage: (from: string, to: string) =>
    getJSON<CoverageSegmentDto[]>(
      `/coverage?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),

  getSessions: (count: number, includeWeekends: boolean, engine = 'futures') =>
    getJSON<SessionDto[]>(
      `/sessions?count=${count}&includeWeekends=${includeWeekends ? 'true' : 'false'}&engine=${encodeURIComponent(engine)}`,
    ),

  getCoverageExtent: (sourceId?: number) =>
    getJSON<CoverageExtentDto>(
      sourceId != null ? `/coverage/extent?sourceId=${sourceId}` : '/coverage/extent',
    ),

  getTradeActivity: (body: TradeActivityRequest) =>
    post<TradeActivityDto[]>('/coverage/activity', body),

  getCaptureLiveness: (body: LivenessQueryRequest) =>
    post<CaptureLivenessDto>('/coverage/liveness', body),

  getLinkLiveness: (body: LivenessQueryRequest) =>
    post<LinkLivenessDto>('/coverage/link', body),

  startRecording: (body: StartRecordingRequest) => post<RecordingDto>('/recordings', body),

  stopRecording: (instrumentId: number): Observable<void> =>
    ajax({ url: `${BASE}/recordings/${instrumentId}`, method: 'DELETE' }).pipe(map(() => undefined)),

  getRecordingSchedule: () => getJSON<RecordingScheduleDto[]>('/recording/schedule'),

  upsertRecordingSchedule: (body: UpsertRecordingScheduleRequest) =>
    put<RecordingScheduleDto[]>('/recording/schedule', body),

  getConnectionSchedule: (connectionId: number) =>
    getJSON<ConnectionScheduleDto>(`/connections/${connectionId}/schedule`),

  putConnectionSchedule: (connectionId: number, body: PutConnectionScheduleRequest) =>
    put<ConnectionScheduleDto>(`/connections/${connectionId}/schedule`, body),

  getConnectionScheduleHistory: (connectionId: number) =>
    getJSON<ConnectionScheduleDto[]>(`/connections/${connectionId}/schedule/history`),

  getNotifications: (limit = 100) => getJSON<NotificationDto[]>(`/notifications?limit=${limit}`),

  connect: (connectionId: number) => post<ConnectionDto>(`/connections/${connectionId}/connect`),
  disconnect: (connectionId: number) =>
    post<ConnectionDto>(`/connections/${connectionId}/disconnect`),
  test: (connectionId: number) => post<ConnectionDto>(`/connections/${connectionId}/test`),

  upsertConnection: (body: UpsertConnectionRequest) => post<ConnectionDto>('/connections', body),

  updateConnection: (connectionId: number, body: UpsertConnectionRequest) =>
    put<ConnectionDto>(`/connections/${connectionId}`, body),

  deleteConnection: (connectionId: number): Observable<void> =>
    ajax({ url: `${BASE}/connections/${connectionId}`, method: 'DELETE' }).pipe(map(() => undefined)),

  validateConnection: (body: ValidateConnectionRequest) =>
    post<ValidateConnectionResult>('/connections/validate', body),

  /** ВРЕМЕННО (dev): префилл логина/пароля из appsettings.Local.json. */
  getTransaqLocalDefaults: () => getJSON<TransaqLocalDefaultsDto>('/connections/transaq-local-defaults'),

  setCredentials: (connectionId: number, body: ConnectionCredentialsRequest): Observable<void> =>
    ajax({
      url: `${BASE}/connections/${connectionId}/credentials`,
      method: 'PUT',
      headers: JSON_HEADERS,
      body,
    }).pipe(map(() => undefined)),

  // Структура биржи (MOEX ISS, прокси/кэш на бэке).
  getEngines: () => getJSON<EngineDto[]>('/exchanges/engines'),
  getMarkets: (engine: string) => getJSON<MarketDto[]>(`/exchanges/${encodeURIComponent(engine)}/markets`),
  getBoards: (engine: string, market: string) =>
    getJSON<BoardDto[]>(`/exchanges/${encodeURIComponent(engine)}/${encodeURIComponent(market)}/boards`),
  getBoardSecurities: (engine: string, market: string, board: string) =>
    getJSON<IssSecurityDto[]>(
      `/exchanges/${encodeURIComponent(engine)}/${encodeURIComponent(market)}/${encodeURIComponent(board)}/securities`,
    ),

  // Справочник классов базового актива фьючерсов + актуализация из ISS (по кнопке).
  getAssetClasses: () => getJSON<FuturesAssetClassDto[]>('/exchanges/asset-classes'),
  refreshAssetClasses: () => post<AssetClassRefreshResultDto>('/exchanges/asset-classes/refresh'),

  // Торговый календарь движка (бесплатный /iss/engines/{engine}).
  getEngineCalendar: (engine: string, from?: string, till?: string) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (till) q.set('till', till);
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return getJSON<CalendarDayDto[]>(`/exchanges/${encodeURIComponent(engine)}/calendar${suffix}`);
  },

  // Действующее на дату расписание движка (курируемая market_schedule, из БД).
  getMarketSchedule: (engine: string, on?: string) => {
    const suffix = on ? `?on=${encodeURIComponent(on)}` : '';
    return getJSON<MarketScheduleDto>(`/exchanges/${encodeURIComponent(engine)}/schedule${suffix}`);
  },

  // Исключения по датам для рынка (market_schedule_exception). По умолчанию — только неразобранные.
  getScheduleExceptions: (market: string, unresolved = true) =>
    getJSON<MarketScheduleExceptionDto[]>(
      `/exchanges/${encodeURIComponent(market)}/exceptions?unresolved=${unresolved}`,
    ),

  // Внешние сервисы-интеграции (external_service, phase 7i): CRUD + health-check + расписание.
  getIntegrations: () => getJSON<ExternalServiceDto[]>('/integrations'),

  createIntegration: (body: UpsertExternalServiceRequest) =>
    post<ExternalServiceDto>('/integrations', body),

  updateIntegration: (serviceId: number, body: UpsertExternalServiceRequest) =>
    put<ExternalServiceDto>(`/integrations/${serviceId}`, body),

  deleteIntegration: (serviceId: number): Observable<void> =>
    ajax({ url: `${BASE}/integrations/${serviceId}`, method: 'DELETE' }).pipe(map(() => undefined)),

  probeIntegration: (serviceId: number) =>
    post<IntegrationProbeResultDto>(`/integrations/${serviceId}/probe`),

  // Расписание: Finam — по символу (SECID@MIC), MOEX ISS — по движку (futures/stock/currency).
  getIntegrationSchedule: (serviceId: number, params: { symbol?: string; engine?: string }) => {
    const query = new URLSearchParams();
    if (params.symbol) query.set('symbol', params.symbol);
    if (params.engine) query.set('engine', params.engine);
    return getJSON<ExternalScheduleDto>(`/integrations/${serviceId}/schedule?${query.toString()}`);
  },

  // Торговый календарь движка (capability «calendar», MOEX ISS dailytable): праздники/переносы.
  getIntegrationCalendar: (
    serviceId: number,
    params: { engine?: string; from?: string; to?: string },
  ) => {
    const query = new URLSearchParams();
    if (params.engine) query.set('engine', params.engine);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    return getJSON<ExternalCalendarDto>(`/integrations/${serviceId}/calendar?${query.toString()}`);
  },

  // Назначить/снять интеграцию источником системного расписания (эксклюзивно).
  setScheduleSource: (serviceId: number, enabled: boolean) =>
    post<ExternalServiceDto>(`/integrations/${serviceId}/schedule-source?enabled=${enabled}`),
};

export type OhsApiClient = typeof OhsApi;
