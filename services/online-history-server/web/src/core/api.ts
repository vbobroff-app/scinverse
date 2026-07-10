import { ajax } from 'rxjs/ajax';
import { map, type Observable } from 'rxjs';
import type {
  ConnectionCredentialsRequest,
  ConnectionDto,
  CoverageExtentDto,
  CoverageSegmentDto,
  InstrumentGroupDto,
  InstrumentPage,
  InstrumentQueryParams,
  RecordingDto,
  SessionDto,
  SourceDto,
  StartRecordingRequest,
  UpsertConnectionRequest,
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

  getSessions: (count: number, includeWeekends: boolean) =>
    getJSON<SessionDto[]>(
      `/sessions?count=${count}&includeWeekends=${includeWeekends ? 'true' : 'false'}`,
    ),

  getCoverageExtent: (sourceId?: number) =>
    getJSON<CoverageExtentDto>(
      sourceId != null ? `/coverage/extent?sourceId=${sourceId}` : '/coverage/extent',
    ),

  startRecording: (body: StartRecordingRequest) => post<RecordingDto>('/recordings', body),

  stopRecording: (instrumentId: number): Observable<void> =>
    ajax({ url: `${BASE}/recordings/${instrumentId}`, method: 'DELETE' }).pipe(map(() => undefined)),

  connect: (connectionId: number) => post<ConnectionDto>(`/connections/${connectionId}/connect`),
  disconnect: (connectionId: number) =>
    post<ConnectionDto>(`/connections/${connectionId}/disconnect`),
  test: (connectionId: number) => post<ConnectionDto>(`/connections/${connectionId}/test`),

  upsertConnection: (body: UpsertConnectionRequest) => post<ConnectionDto>('/connections', body),

  setCredentials: (connectionId: number, body: ConnectionCredentialsRequest): Observable<void> =>
    ajax({
      url: `${BASE}/connections/${connectionId}/credentials`,
      method: 'PUT',
      headers: JSON_HEADERS,
      body,
    }).pipe(map(() => undefined)),
};

export type OhsApiClient = typeof OhsApi;
