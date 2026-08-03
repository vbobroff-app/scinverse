import { vi, afterEach } from 'vitest';
import { Observable, Subject, of, throwError, timer } from 'rxjs';
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

/** Debounce ленты I12 (должен совпадать с RIBBON_REFRESH_DEBOUNCE_MS в OhsStore). */
const RIBBON_REFRESH_DEBOUNCE_MS = 150;

/** Дождаться debounce + sync-ответов `of(...)` в pipeline ленты. */
function flushRibbonRefresh(): void {
  vi.advanceTimersByTime(RIBBON_REFRESH_DEBOUNCE_MS);
}

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
  // Мок покрывает методы, которые дёргает стор; прочие (биржи/интеграции) в этих тестах не нужны —
  // Partial + cast, чтобы рост OhsApiClient не заставлял стабить неиспользуемое (сигнатуры покрытых
  // методов при этом остаются строго типизированными).
  const base: Partial<OhsApiClient> = {
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
    getConnectionIncidents: () => of([]),
    getIncidents: () => of({ items: [], total: 0, limit: 100, offset: 0 }),
    getIncident: () =>
      of({
        corrUid: '',
        module: 'connection',
        type: 'break',
        status: 'resolved',
        openedAt: '1970-01-01T00:00:00.000Z',
        subject: '',
        severity: 'ok',
        title: '',
        lastActivityAt: '1970-01-01T00:00:00.000Z',
        durationMs: 0,
      }),
    startRecording: () => of({} as RecordingDto),
    stopRecording: () => of(undefined),
    getRecordingSchedule: () => of([]),
    upsertRecordingSchedule: () => of([]),
    getConnectionSchedule: () =>
      of({
        settings: { connectionId: 0, autoEnabled: false, engine: 'futures', tz: 'Europe/Moscow' },
        rules: [],
      }),
    putConnectionScheduleSettings: () =>
      of({ connectionId: 0, autoEnabled: false, engine: 'futures', tz: 'Europe/Moscow' }),
    refreshInstrumentCatalog: () => of({ invalidated: true, isFresh: false }),
    applyScheduleBatch: () => of({ ok: true, applied: [], superseded: [] }),
    getConnectionScheduleHistory: () => of([]),
    getNotifications: () => of([]),
    postNotification: () => of(undefined as unknown as void),
    reportHostOutage: () => of({}),
    holdRecovery: () => of(undefined as unknown as void),
    connect: () => of(connection({ status: 'connected' })),
    disconnect: () => of(connection({ status: 'disconnected' })),
    test: () => of(connection()),
    upsertConnection: () => of(connection()),
    updateConnection: () => of(connection()),
    deleteConnection: () => of(undefined),
    validateConnection: () => of<ValidateConnectionResult>({ ok: true }),
    setCredentials: () => of(undefined),
  };
  return { ...base, ...overrides } as OhsApiClient;
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

describe('OhsStore showWorkGaps mutex', () => {
  it('вкл. Гэпы снимает Инциденты связи/сервера', () => {
    const store = new OhsStore(fakeApi());
    expect(store.showBreakIncidents$.value).toBe(true);
    expect(store.showCrashIncidents$.value).toBe(true);
    store.setShowWorkGaps(true);
    expect(store.showWorkGaps$.value).toBe(true);
    expect(store.showBreakIncidents$.value).toBe(false);
    expect(store.showCrashIncidents$.value).toBe(false);
  });

  it('вкл. любого инцидента снимает Гэпы', () => {
    const store = new OhsStore(fakeApi());
    store.setShowWorkGaps(true);
    store.setShowBreakIncidents(true);
    expect(store.showWorkGaps$.value).toBe(false);
    expect(store.showBreakIncidents$.value).toBe(true);

    store.setShowWorkGaps(true);
    store.setShowCrashIncidents(true);
    expect(store.showWorkGaps$.value).toBe(false);
    expect(store.showCrashIncidents$.value).toBe(true);
  });

  it('выкл. Гэпов не возвращает инциденты', () => {
    const store = new OhsStore(fakeApi());
    store.setShowWorkGaps(true);
    store.setShowWorkGaps(false);
    expect(store.showWorkGaps$.value).toBe(false);
    expect(store.showBreakIncidents$.value).toBe(false);
    expect(store.showCrashIncidents$.value).toBe(false);
  });
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

  it('error на тумблере сбрасывается в disconnected через 5с', () => {
    vi.useFakeTimers();
    const live = new Subject<LiveEvent>();
    const store = new OhsStore(
      fakeApi({ connect: () => throwError(() => new Error('TRANSAQ connect failed')) }),
      live,
    );
    store.start();

    store.connect(1);
    expect(store.connections$.value[0].status).toBe('error');

    vi.advanceTimersByTime(4_999);
    expect(store.connections$.value[0].status).toBe('error');

    vi.advanceTimersByTime(1);
    expect(store.connections$.value[0].status).toBe('disconnected');
    store.stop();
    vi.useRealTimers();
  });

  it('новый connect снимает error сразу (connecting)', () => {
    vi.useFakeTimers();
    const live = new Subject<LiveEvent>();
    let calls = 0;
    const store = new OhsStore(
      fakeApi({
        connect: () => {
          calls += 1;
          return calls === 1
            ? throwError(() => new Error('fail'))
            : of(connection({ status: 'waiting' }));
        },
      }),
      live,
    );
    store.start();

    store.connect(1);
    expect(store.connections$.value[0].status).toBe('error');

    store.connect(1);
    // of(waiting) синхронно сменяет connecting — красный error снят.
    expect(store.connections$.value[0].status).toBe('waiting');
    store.stop();
    vi.useRealTimers();
  });

  it('двигает счётчик активной колбаски по coverageExtended без перезапроса', () => {
    vi.useFakeTimers();
    const live = new Subject<LiveEvent>();
    const store = new OhsStore(fakeApi(), live);
    store.start();
    flushRibbonRefresh();

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
    vi.useRealTimers();
  });

  it('заполняет activity$ батчем по setActivityContext', () => {
    vi.useFakeTimers();
    const bucketTs = '2026-01-05T10:00:00.000Z';
    const store = new OhsStore(
      fakeApi({ getTradeActivity: () => of([{ instrumentId: 100, buckets: [bucketTs] }]) }),
      new Subject<LiveEvent>(),
    );
    store.start();

    store.setActivityContext([100], 2);
    flushRibbonRefresh();

    expect(store.activity$.value.byInstrument.get(100)).toEqual([Date.parse(bucketTs)]);
    store.stop();
    vi.useRealTimers();
  });

  it('живой край: coverageExtended добавляет бакет последней сделки', () => {
    vi.useFakeTimers();
    const live = new Subject<LiveEvent>();
    const store = new OhsStore(
      fakeApi({ getTradeActivity: () => of([{ instrumentId: 100, buckets: [] }]) }),
      live,
    );
    store.start();
    store.setActivityContext([100], 2);
    flushRibbonRefresh();
    expect(store.activity$.value.byInstrument.get(100)).toEqual([]);

    const ts = '2026-01-05T10:00:17.000Z';
    live.next({ type: 'coverageExtended', instrumentId: 100, sourceId: 2, to: ts, tradeCount: 1 });

    const { bucketMs, byInstrument } = store.activity$.value;
    const expected = Math.floor(Date.parse(ts) / bucketMs) * bucketMs;
    expect(byInstrument.get(100)).toEqual([expected]);
    store.stop();
    vi.useRealTimers();
  });

  it('I12: залп refresh* → не больше одного тяжёлого запроса одновременно', () => {
    vi.useFakeTimers();
    let inflight = 0;
    let maxInflight = 0;
    const track = <T>(value: T): Observable<T> =>
      new Observable<T>((subscriber) => {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        let held = true;
        const release = () => {
          if (!held) {
            return;
          }
          held = false;
          inflight -= 1;
        };
        const sub = timer(20).subscribe({
          next: () => {
            release();
            subscriber.next(value);
            subscriber.complete();
          },
        });
        return () => {
          release();
          sub.unsubscribe();
        };
      });

    const store = new OhsStore(
      fakeApi({
        getCoverage: () => track([segment()]),
        getTradeActivity: () => track([]),
        getCaptureLiveness: () => track({ intervals: [], gaps: [] }),
        getLinkLiveness: () => track({ intervals: [], gaps: [] }),
        getConnectionIncidents: () => track([]),
      }),
      new Subject<LiveEvent>(),
    );
    store.setLivenessSource(2);
    store.setActivityContext([100], 2);
    // Залп как после recover / break (до debounce).
    store.refreshCoverage();
    store.refreshActivity();
    store.refreshLiveness();
    store.refreshCoverage();
    store.refreshLiveness();

    flushRibbonRefresh();
    // Дождаться всей последовательной цепочки (4 шага × 20 ms + запас).
    vi.advanceTimersByTime(200);

    expect(maxInflight).toBe(1);
    store.stop();
    vi.useRealTimers();
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

  it('D+: D2 — завтра и сегодня (якорь сдвинут вперёд)', () => {
    const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    store.start();

    store.setTimeframe({ kind: 'sessions', unit: 'D', count: 2, includeWeekends: true });
    store.setDPlus(true);

    expect(store.dPlus$.value).toBe(true);
    expect(store.sessions$.value.map((s) => s.date)).toEqual(['2026-07-08', '2026-07-09']);
    store.stop();
  });

  it('D+ выкл: D2 — сегодня и вчера', () => {
    const store = new OhsStore(fakeApi(), new Subject<LiveEvent>());
    store.start();

    store.setDPlus(true);
    store.setTimeframe({ kind: 'sessions', unit: 'D', count: 2, includeWeekends: true });
    store.setDPlus(false);

    expect(store.sessions$.value.map((s) => s.date)).toEqual(['2026-07-07', '2026-07-08']);
    store.stop();
  });

  it('D+: поздний ответ getSessions после переключения не сбивает завтра', () => {
    const pending: Subject<SessionDto[]>[] = [];
    const getSessions = vi.fn(() => {
      const s = new Subject<SessionDto[]>();
      pending.push(s);
      return s.asObservable();
    });
    const store = new OhsStore(fakeApi({ getSessions }), new Subject<LiveEvent>());
    store.start();

    store.setTimeframe({ kind: 'sessions', unit: 'D', count: 2, includeWeekends: true });
    store.setDPlus(true);
    expect(store.sessions$.value.map((s) => s.date)).toEqual(['2026-07-08', '2026-07-09']);

    store.setDPlus(false);
    expect(store.sessions$.value.map((s) => s.date)).toEqual(['2026-07-07', '2026-07-08']);

    store.setDPlus(true);
    expect(store.sessions$.value.map((s) => s.date)).toEqual(['2026-07-08', '2026-07-09']);

    // Stale ответ «без D+» — должен быть отменён unsubscribe'ом.
    const stale = pending[pending.length - 2];
    stale?.next([]);
    stale?.complete();
    expect(store.sessions$.value.map((s) => s.date)).toEqual(['2026-07-08', '2026-07-09']);
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
