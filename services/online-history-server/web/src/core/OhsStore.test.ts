import { vi } from 'vitest';
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
    store.stop();
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
    store.stop();
  });

  it('держит ось статичной, пока now внутри окна, и перелистывает при переходе через край', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'));
    try {
      const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
      store.start();

      const initial = store.window$.value;
      const span = Date.parse(initial.to) - Date.parse(initial.from);

      // now ещё внутри окна → ось не двигается.
      vi.advanceTimersByTime(5000);
      expect(store.window$.value).toEqual(initial);

      // Перешли правый край (задел = 15% ширины) → окно перелистнулось вперёд.
      vi.advanceTimersByTime(span * 0.15);
      const after = store.window$.value;
      expect(Date.parse(after.to)).toBeGreaterThan(Date.parse(initial.to));
      expect(Date.parse(after.to) - Date.parse(after.from)).toBe(span);
      store.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
