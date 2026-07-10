import { of, Subject } from 'rxjs';
import { OhsStore } from './OhsStore';
import type { OhsApiClient } from './api';
import type {
  ConnectionDto,
  CoverageSegmentDto,
  InstrumentPage,
  LiveEvent,
  RecordingDto,
} from './types';

function connection(overrides: Partial<ConnectionDto> = {}): ConnectionDto {
  return {
    connectionId: 1,
    sourceId: 2,
    name: 'synthetic-local',
    kind: 'synthetic',
    settings: '{}',
    enabled: true,
    status: 'disconnected',
    ...overrides,
  };
}

function segment(overrides: Partial<CoverageSegmentDto> = {}): CoverageSegmentDto {
  return {
    segmentId: 10,
    instrumentId: 100,
    sourceId: 2,
    from: new Date().toISOString(),
    to: null,
    tradeCount: 0,
    status: 'recording',
    gaps: [],
    ...overrides,
  };
}

function fakeApi(overrides: Partial<OhsApiClient> = {}): OhsApiClient {
  const emptyPage: InstrumentPage = { items: [], total: 0, limit: 100, offset: 0 };
  const base: OhsApiClient = {
    getInstruments: () => of(emptyPage),
    getInstrumentSeries: () => of([]),
    getSources: () => of([]),
    getConnections: () => of([connection()]),
    getRecordings: () => of<RecordingDto[]>([]),
    getCoverage: () => of([segment()]),
    startRecording: () => of({} as RecordingDto),
    stopRecording: () => of(undefined),
    connect: () => of(connection({ status: 'connected' })),
    disconnect: () => of(connection({ status: 'disconnected' })),
    test: () => of(connection()),
    upsertConnection: () => of(connection()),
    setCredentials: () => of(undefined),
  };
  return { ...base, ...overrides };
}

describe('OhsStore live merge', () => {
  it('обновляет статус подключения по connectionStatusChanged', () => {
    const live = new Subject<LiveEvent>();
    const store = new OhsStore(fakeApi(), live);
    store.start();

    expect(store.connections$.value[0].status).toBe('disconnected');
    live.next({ type: 'connectionStatusChanged', connectionId: 1, status: 'connected' });

    expect(store.connections$.value[0].status).toBe('connected');
  });

  it('двигает счётчик активной колбаски по coverageExtended без перезапроса', () => {
    const live = new Subject<LiveEvent>();
    const store = new OhsStore(fakeApi(), live);
    store.start();

    expect(store.coverage$.value[0].tradeCount).toBe(0);
    live.next({
      type: 'coverageExtended',
      instrumentId: 100,
      sourceId: 2,
      to: new Date().toISOString(),
      tradeCount: 42,
    });

    expect(store.coverage$.value[0].tradeCount).toBe(42);
  });
});
