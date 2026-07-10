import { vi } from 'vitest';
import { of, Subject } from 'rxjs';
import { OhsStore } from './OhsStore';
import type { OhsApiClient } from './api';
import { todaySession } from './moexSession';
import type {
  ConnectionDto,
  CoverageExtentDto,
  CoverageSegmentDto,
  InstrumentPage,
  LiveEvent,
  RecordingDto,
  SessionDto,
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

/** ISO строка сессии для даты МСК. */
function session(dateIso: string, weekend = false): SessionDto {
  return {
    date: dateIso,
    start: `${dateIso}T08:50:00+03:00`,
    end: `${dateIso}T23:50:00+03:00`,
    weekend,
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
    getSessions: () => of<SessionDto[]>([]),
    getCoverageExtent: () => of<CoverageExtentDto>({ from: null, to: null }),
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

});

describe('OhsStore timeframe → window', () => {
  it('по умолчанию D1: окно = сегодняшняя сессия, правый край = конец сессии', () => {
    const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    store.start();

    const today = todaySession();
    expect(Date.parse(store.window$.value.to)).toBe(today.endMs);
    store.stop();
  });

  it('W1 без выходных запрашивает 5 сессий и берёт левый край самой ранней', () => {
    const getSessions = vi.fn(() =>
      of([session('2026-07-06'), session('2026-07-08'), session('2026-07-10')]),
    );
    const store = new OhsStore(fakeApi({ getSessions }), new Subject<LiveEvent>());
    store.start();

    store.setTimeframe({ kind: 'sessions', unit: 'W', count: 1, includeWeekends: false });

    expect(getSessions).toHaveBeenLastCalledWith(5, false);
    expect(store.window$.value.from).toBe(new Date(Date.parse('2026-07-06T08:50:00+03:00')).toISOString());
    expect(Date.parse(store.window$.value.to)).toBe(todaySession().endMs);
    expect(store.sessions$.value).toHaveLength(3);
    store.stop();
  });

  it('W1 с выходными запрашивает 7 сессий', () => {
    const getSessions = vi.fn(() => of<SessionDto[]>([]));
    const store = new OhsStore(fakeApi({ getSessions }), new Subject<LiveEvent>());
    store.start();

    store.setTimeframe({ kind: 'sessions', unit: 'W', count: 1, includeWeekends: true });

    expect(getSessions).toHaveBeenLastCalledWith(7, true);
    store.stop();
  });

  it('All берёт левый край из coverage/extent', () => {
    const getCoverageExtent = vi.fn(() =>
      of<CoverageExtentDto>({ from: '2026-01-01T00:00:00Z', to: null }),
    );
    const store = new OhsStore(fakeApi({ getCoverageExtent }), new Subject<LiveEvent>());
    store.start();

    store.setTimeframe({ kind: 'all' });

    expect(getCoverageExtent).toHaveBeenCalled();
    expect(store.window$.value.from).toBe(new Date('2026-01-01T00:00:00Z').toISOString());
    expect(store.sessions$.value).toHaveLength(0);
    store.stop();
  });

  it('range снапает границы к началу/концу сессий', () => {
    const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    store.start();

    store.setTimeframe({ kind: 'range', from: '2026-07-06', to: '2026-07-08', includeWeekends: false });

    expect(store.window$.value.from).toBe(new Date('2026-07-06T08:50:00+03:00').toISOString());
    expect(store.window$.value.to).toBe(new Date('2026-07-08T23:50:00+03:00').toISOString());
    store.stop();
  });
});
