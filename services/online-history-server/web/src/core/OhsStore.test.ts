import { vi, afterEach } from 'vitest';
import { of, Subject, throwError, type Observable } from 'rxjs';
import { OhsStore } from './OhsStore';
import type { OhsApiClient } from './api';
import { loadSelectedInstruments } from './selectedInstrumentsStorage';
import { todaySession } from './moexSession';
import type {
  ConnectionDto,
  CoverageExtentDto,
  CoverageSegmentDto,
  InstrumentDto,
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
    getTradeActivity: () => of([]),
    getCaptureLiveness: () => of({ intervals: [], gaps: [] }),
    getLinkLiveness: () => of({ intervals: [], gaps: [] }),
    startRecording: () => of({} as RecordingDto),
    stopRecording: () => of(undefined),
    getRecordingSchedule: () => of([]),
    upsertRecordingSchedule: () => of([]),
    getConnectionSchedule: () => of({} as never),
    putConnectionSchedule: () => of({} as never),
    getConnectionScheduleHistory: () => of([]),
    getNotifications: () => of([]),
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

function futures(overrides: Partial<InstrumentDto> = {}): InstrumentDto {
  return {
    instrumentId: 500,
    ticker: 'Si-9.26',
    board: 'RFUD',
    secType: 'FUT',
    shortName: null,
    name: null,
    minStep: 1,
    decimals: 0,
    active: true,
    recording: false,
    hasOptions: true,
    strike: null,
    optionType: null,
    expiration: null,
    ...overrides,
  };
}

afterEach(() => {
  localStorage.removeItem('ohs:selectedInstruments');
  localStorage.removeItem('ohs:viewState');
});

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

  it('обновляет статус подключения по connectionStateChanged (Down)', () => {
    const live = new Subject<LiveEvent>();
    const store = new OhsStore(fakeApi(), live);
    store.start();

    live.next({
      type: 'connectionStateChanged',
      connectionId: 1,
      state: 'Down',
      since: '2026-07-12T10:00:00.000Z',
      reason: 'server_status',
    });

    expect(store.connections$.value[0].status).toBe('disconnected');
    store.stop();
  });

  it('маппит Degraded в статус degraded', () => {
    const live = new Subject<LiveEvent>();
    const store = new OhsStore(fakeApi(), live);
    store.start();

    live.next({
      type: 'connectionStateChanged',
      connectionId: 1,
      state: 'Degraded',
      since: '2026-07-12T10:00:00.000Z',
      reason: 'recover',
    });

    expect(store.connections$.value[0].status).toBe('degraded');
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

  it('заполняет activity$ батчем по setActivityContext', () => {
    const bucketTs = '2026-01-05T10:00:00.000Z';
    const store = new OhsStore(
      fakeApi({ getTradeActivity: () => of([{ instrumentId: 100, buckets: [bucketTs] }]) }),
      new Subject<LiveEvent>(),
    );
    store.start();

    store.setActivityContext([100], 2);

    expect(store.activity$.value.byInstrument.get(100)).toEqual([Date.parse(bucketTs)]);
    store.stop();
  });

  it('живой край: coverageExtended добавляет бакет последней сделки', () => {
    const live = new Subject<LiveEvent>();
    const store = new OhsStore(
      fakeApi({ getTradeActivity: () => of([{ instrumentId: 100, buckets: [] }]) }),
      live,
    );
    store.start();
    store.setActivityContext([100], 2);
    expect(store.activity$.value.byInstrument.get(100)).toEqual([]);

    const ts = '2026-01-05T10:00:17.000Z';
    live.next({ type: 'coverageExtended', instrumentId: 100, sourceId: 2, to: ts, tradeCount: 1 });

    const { bucketMs, byInstrument } = store.activity$.value;
    const expected = Math.floor(Date.parse(ts) / bucketMs) * bucketMs;
    expect(byInstrument.get(100)).toEqual([expected]);
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

  it('звезда серии выделяет и снимает все её опционы', () => {
    const options = [
      futures({ instrumentId: 901, secType: 'OPT', hasOptions: false }),
      futures({ instrumentId: 902, secType: 'OPT', hasOptions: false }),
    ];
    const store = new OhsStore(
      fakeApi({
        getInstruments: (params) =>
          params.underlyingId === 500
            ? of({ items: options, total: 2, limit: 500, offset: 0 })
            : of({ items: [], total: 0, limit: 100, offset: 0 }),
      }),
      new Subject<LiveEvent>(),
    );

    store.toggleSeriesSelection(500, '2026-09-18');
    expect([...store.selectedInstruments$.value].sort()).toEqual([901, 902]);

    store.toggleSeriesSelection(500, '2026-09-18');
    expect([...store.selectedInstruments$.value]).toEqual([]);
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
    // Каталог + резолв spine выделенных OPT (category=options).
    expect(getInstruments).toHaveBeenCalledTimes(2);
    expect(getInstruments.mock.calls[0][0].instrumentIds).toEqual([3]);
    expect(getInstruments.mock.calls[1][0]).toMatchObject({
      instrumentIds: [3],
      category: 'options',
    });
    store.stop();
  });

  it('«Выделенные»: авто-раскрывает spine future → series по OPT', () => {
    const option = futures({
      instrumentId: 901,
      ticker: 'SiU6C65000',
      board: 'ROPD',
      secType: 'OPT',
      hasOptions: false,
      underlyingId: 500,
      expiration: '2026-09-18',
      strike: 65000,
      optionType: 'C',
    });
    const getInstruments = vi.fn<(params: InstrumentQueryParams) => Observable<InstrumentPage>>(
      (params) => {
        if (params.category === 'options') {
          return of({ items: [option], total: 1, limit: 500, offset: 0 });
        }
        return of({
          items: [futures({ instrumentId: 500 })],
          total: 1,
          limit: 100,
          offset: 0,
        });
      },
    );
    const getInstrumentSeries = vi.fn(() =>
      of([
        {
          key: '2026-09-18',
          label: 'Si U6',
          count: 1,
          expiration: '2026-09-18',
          badge: 'Q3',
        },
      ]),
    );
    const store = new OhsStore(
      fakeApi({ getInstruments, getInstrumentSeries }),
      new Subject<LiveEvent>(),
    );
    store.start();
    store.toggleInstrumentSelection(901);
    store.setSelectionConditions({ recording: false, nonEmpty: false, selected: true });

    expect([...store.expandedFutures$.value]).toEqual([500]);
    expect([...store.selectedOptionSpine$.value.get(500) ?? []]).toEqual(['2026-09-18']);
    expect([...store.selectionLeafIds$.value]).toEqual([901]);
    expect([...store.expandedSeries$.value]).toEqual(['500:2026-09-18']);
    expect(getInstrumentSeries).toHaveBeenCalledWith(500);
    store.stop();
  });

  it('scope «только к БА» не раскрывает spine опционов', () => {
    const option = futures({
      instrumentId: 901,
      secType: 'OPT',
      hasOptions: false,
      underlyingId: 500,
      expiration: '2026-09-18',
    });
    const getInstruments = vi.fn<(params: InstrumentQueryParams) => Observable<InstrumentPage>>(
      (params) => {
        if (params.category === 'options') {
          return of({ items: [option], total: 1, limit: 500, offset: 0 });
        }
        return of({ items: [], total: 0, limit: 100, offset: 0 });
      },
    );
    const store = new OhsStore(fakeApi({ getInstruments }), new Subject<LiveEvent>());
    store.start();
    store.toggleInstrumentSelection(901);
    store.setSelectionScope('base');
    store.setSelectionConditions({ recording: false, nonEmpty: false, selected: true });

    expect(store.instrumentQuery$.value.includeOptionAncestors).toBe(false);
    expect(store.selectedOptionSpine$.value.size).toBe(0);
    expect(store.selectionLeafIds$.value.size).toBe(0);
    expect(getInstruments.mock.calls.some((c) => c[0].category === 'options')).toBe(false);
    store.stop();
  });

  it('сохраняет выделение в localStorage и восстанавливает после перезагрузки', () => {
    const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    store.toggleInstrumentSelection(11);
    store.toggleInstrumentSelection(22);

    expect([...loadSelectedInstruments()].sort((a, b) => a - b)).toEqual([11, 22]);

    const reloaded = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    expect([...reloaded.selectedInstruments$.value].sort((a, b) => a - b)).toEqual([11, 22]);
  });

  it('сохраняет раскрытые фьючерс/серию и восстанавливает после перезагрузки', () => {
    const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    store.start();
    store.toggleFutures(futures({ instrumentId: 500 }));
    store.toggleSeries(500, '2026-07-16');
    store.stop();

    const reloaded = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    expect([...reloaded.expandedFutures$.value]).toEqual([500]);
    expect([...reloaded.expandedSeries$.value]).toEqual(['500:2026-07-16']);
  });

  it('сохраняет активного провайдера и восстанавливает после перезагрузки', () => {
    const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    store.setActiveConnection(3);
    store.stop();

    const reloaded = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    expect(reloaded.activeConnectionId$.value).toBe(3);
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

  it('D1: часы сессии подменяются из getSessions (ISS)', () => {
    const issDay: SessionDto = {
      date: '2026-07-08',
      start: '2026-07-08T04:00:00.000Z',
      end: '2026-07-08T21:00:00.000Z',
      weekend: false,
    };
    const getSessions = vi.fn(() => of([issDay]));
    const store = new OhsStore(fakeApi({ getSessions }), new Subject<LiveEvent>());
    store.start();

    expect(getSessions).toHaveBeenCalledWith(1, true, 'futures');
    const day = store.sessions$.value[0];
    expect(day.date).toBe('2026-07-08');
    expect(day.start).toBe(issDay.start);
    expect(day.end).toBe(issDay.end);
    store.stop();
  });

  it('D1: при ошибке getSessions — фолбэк на локальную эвристику', () => {
    const getSessions = vi.fn(() => throwError(() => new Error('iss down')));
    const store = new OhsStore(fakeApi({ getSessions }), new Subject<LiveEvent>());
    store.start();

    const today = todaySession();
    expect(store.sessions$.value).toHaveLength(1);
    expect(Date.parse(store.sessions$.value[0].start)).toBe(today.startMs);
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

  it('W1, только будни через тайм-лайн-фильтр: 5 будних сессий', () => {
    const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    store.start();

    store.setTimelineFilter({ weekdays: new Set([1, 2, 3, 4, 5]) });
    store.setTimeframe({ kind: 'sessions', unit: 'W', count: 1, includeWeekends: true });

    const s = store.sessions$.value;
    expect(s).toHaveLength(5);
    expect(s.every((x) => !x.weekend)).toBe(true);
    store.stop();
  });

  it('окно дня «полные сутки» (Full, сессия не выбрана): день растянут на 24ч от МСК-полуночи', () => {
    const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    store.start();

    store.setTimeframe({ kind: 'sessions', unit: 'D', count: 1, includeWeekends: true });
    store.setTimelineFilter({ fullDay: true, session: { mode: 'none' } });

    const s = store.sessions$.value;
    expect(s).toHaveLength(1);
    const day = s[0];
    const span = Date.parse(day.end) - Date.parse(day.start);
    expect(span).toBe(24 * 60 * 60 * 1000);
    // Старт окна — МСК-полночь = 21:00 UTC предыдущих суток.
    expect(new Date(day.start).getUTCHours()).toBe(21);
    // Сессия не выбрана — зон подсветки нет.
    expect(day.sessionStart).toBeUndefined();
    store.stop();
  });

  it('Full + сессия MOEX: день 24ч + границы сессии в sessionStart/End (зоны pre/session/post)', () => {
    const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    store.start();

    store.setTimeframe({ kind: 'sessions', unit: 'D', count: 1, includeWeekends: true });
    store.setTimelineFilter({ fullDay: true, session: { mode: 'session', exchange: 'MOEX' } });

    const day = store.sessions$.value[0];
    expect(Date.parse(day.end) - Date.parse(day.start)).toBe(24 * 60 * 60 * 1000);
    expect(day.sessionStart).toBeDefined();
    expect(day.sessionEnd).toBeDefined();
    // Границы сессии — строго внутри суток.
    expect(Date.parse(day.sessionStart!)).toBeGreaterThanOrEqual(Date.parse(day.start));
    expect(Date.parse(day.sessionEnd!)).toBeLessThanOrEqual(Date.parse(day.end));
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

  it('подтягивает бэклог уведомлений (GET /api/notifications) при старте', () => {
    const getNotifications = vi.fn(() => of([]));
    const store = new OhsStore(fakeApi({ getNotifications }), new Subject<LiveEvent>());
    store.start();

    expect(getNotifications).toHaveBeenCalled();
    store.stop();
  });
});
