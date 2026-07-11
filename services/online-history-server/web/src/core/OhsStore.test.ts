import { vi } from 'vitest';
import { of, Subject, type Observable } from 'rxjs';
import { OhsStore } from './OhsStore';
import type { OhsApiClient } from './api';
import { todaySession } from './moexSession';
import type {
  ConnectionDto,
  CoverageExtentDto,
  CoverageSegmentDto,
  InstrumentPage,
  InstrumentQueryParams,
  LiveEvent,
  RecordingDto,
  SessionDto,
  ValidateConnectionResult,
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
    getSessions: () => of<SessionDto[]>([]),
    getCoverageExtent: () => of<CoverageExtentDto>({ from: null, to: null }),
    startRecording: () => of({} as RecordingDto),
    stopRecording: () => of(undefined),
    connect: () => of(connection({ status: 'connected' })),
    disconnect: () => of(connection({ status: 'disconnected' })),
    test: () => of(connection()),
    upsertConnection: () => of(connection()),
    updateConnection: () => of(connection()),
    deleteConnection: () => of(undefined),
    validateConnection: () => of<ValidateConnectionResult>({ ok: true }),
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

describe('OhsStore фильтры-плашки', () => {
  it('add/remove/clear меняют activeFilters$ и очищают поля запроса', () => {
    const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    store.start();

    store.addFilter('instruments');
    store.addFilter('selection');
    store.addFilter('instruments'); // повтор игнорируется
    expect(store.activeFilters$.value).toEqual(['instruments', 'selection']);

    store.setCategory('futures');
    expect(store.instrumentQuery$.value.category).toBe('futures');

    store.removeFilter('instruments');
    expect(store.activeFilters$.value).toEqual(['selection']);
    expect(store.instrumentQuery$.value.category).toBeUndefined();

    store.setSelectionConditions({ recording: true, nonEmpty: true, selected: false });
    store.clearFilters();
    expect(store.activeFilters$.value).toEqual([]);
    expect(store.instrumentQuery$.value.onlyRecording).toBeUndefined();
    expect(store.instrumentQuery$.value.nonEmpty).toBeUndefined();
    store.stop();
  });

  it('setSelectionConditions маппит условия в query-поля (И-комбинация)', () => {
    const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    store.start();
    store.toggleInstrumentSelection(7);

    store.setSelectionConditions({ recording: true, nonEmpty: true, selected: true });
    const q = store.instrumentQuery$.value;
    expect(q.onlyRecording).toBe(true);
    expect(q.nonEmpty).toBe(true);
    expect(q.instrumentIds).toEqual([7]);
    store.stop();
  });

  it('при активном условии «Выделенные» смена выделения пере-запрашивает каталог', () => {
    const getInstruments = vi.fn<(params: InstrumentQueryParams) => Observable<InstrumentPage>>(
      () => of<InstrumentPage>({ items: [], total: 0, limit: 100, offset: 0 }),
    );
    const store = new OhsStore(fakeApi({ getInstruments }), new Subject<LiveEvent>());
    store.start();

    store.setSelectionConditions({ recording: false, nonEmpty: false, selected: true });
    getInstruments.mockClear();

    store.toggleInstrumentSelection(3);
    expect(getInstruments).toHaveBeenCalledTimes(1);
    expect(getInstruments.mock.calls[0][0].instrumentIds).toEqual([3]);
    store.stop();
  });
});

describe('OhsStore timeframe → window', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T09:00:00Z')); // среда, 12:00 МСК
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('по умолчанию D1: окно = сегодняшняя сессия, правый край = конец сессии', () => {
    const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    store.start();

    const today = todaySession();
    expect(Date.parse(store.window$.value.to)).toBe(today.endMs);
    expect(store.sessions$.value).toHaveLength(1);
    store.stop();
  });

  it('D3: три календарные сессии подряд (ось равными долями)', () => {
    const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    store.start();

    store.setTimeframe({ kind: 'sessions', unit: 'D', count: 3, includeWeekends: true });

    expect(store.sessions$.value.map((s) => s.date)).toEqual([
      '2026-07-06',
      '2026-07-07',
      '2026-07-08',
    ]);
    expect(store.window$.value.from).toBe(store.sessions$.value[0].start);
    expect(Date.parse(store.window$.value.to)).toBe(todaySession().endMs);
    store.stop();
  });

  it('W1 с выходными: 7 календарных сессий, выходные — отдельные слоты (не схлопнуты)', () => {
    const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    store.start();

    store.setTimeframe({ kind: 'sessions', unit: 'W', count: 1, includeWeekends: true });

    const s = store.sessions$.value;
    expect(s).toHaveLength(7);
    expect(s.filter((x) => x.weekend)).toHaveLength(2); // суббота + воскресенье
    expect(store.window$.value.from).toBe(s[0].start);
    store.stop();
  });

  it('W1 без выходных: 5 будних сессий (выходные схлопнуты фильтром)', () => {
    const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    store.start();

    store.setTimeframe({ kind: 'sessions', unit: 'W', count: 1, includeWeekends: false });

    const s = store.sessions$.value;
    expect(s).toHaveLength(5);
    expect(s.every((x) => !x.weekend)).toBe(true);
    store.stop();
  });

  it('M1 посессионный: много дневных сессий, правый край = конец сегодняшней', () => {
    const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    store.start();

    store.setTimeframe({ kind: 'sessions', unit: 'M', count: 1, includeWeekends: true });

    // ~месяц календарных дней → заметно больше 16 сессий (включён режим прореживания оси).
    expect(store.sessions$.value.length).toBeGreaterThan(16);
    expect(Date.parse(store.window$.value.to)).toBe(todaySession().endMs);
    expect(store.window$.value.from).toBe(store.sessions$.value[0].start);
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

  it('range посессионный: слот на каждый день диапазона, границы по сессиям', () => {
    const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    store.start();

    store.setTimeframe({ kind: 'range', from: '2026-07-06', to: '2026-07-08', includeWeekends: true });

    expect(store.sessions$.value.map((s) => s.date)).toEqual([
      '2026-07-06',
      '2026-07-07',
      '2026-07-08',
    ]);
    expect(store.window$.value.from).toBe(new Date('2026-07-06T08:50:00+03:00').toISOString());
    expect(store.window$.value.to).toBe(new Date('2026-07-08T23:50:00+03:00').toISOString());
    store.stop();
  });
});
