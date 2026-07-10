import { BehaviorSubject, type Observable, type Subscription } from 'rxjs';
import { OhsApi, type OhsApiClient } from './api';
import { createLiveStream } from './live';
import {
  mskDateFromIso,
  mskDateOf,
  recentSessions,
  sessionBounds,
  sessionsFrom,
  shiftMonths,
  todaySession,
} from './moexSession';
import type {
  ConnectionDto,
  CoverageSegmentDto,
  FilterKey,
  InstrumentDto,
  InstrumentGroupDto,
  InstrumentQueryParams,
  LiveEvent,
  RecordingDto,
  SessionDto,
  SourceDto,
  StartRecordingRequest,
  Timeframe,
  TimeframeUnit,
} from './types';

/** Флаги условий плашки «Выбор» (проекция query-параметров для чек-листа). */
export interface SelectionConditions {
  recording: boolean;
  nonEmpty: boolean;
  selected: boolean;
}

const DEFAULT_PAGE_SIZE = 100;

/** Как часто перезапрашивать покрытие (живые гэпы внутри активной сессии). */
const COVERAGE_POLL_MS = 12_000;
/** Как часто пересчитывать окно (ловим смену суток/рост экстента; для range — no-op). */
const WINDOW_REFRESH_MS = 60_000;
/** Сколько сессий в неделе при выключенных/включённых выходных. */
const SESSIONS_PER_WEEK = { workdays: 5, withWeekends: 7 } as const;
/**
 * Таймфрейм по умолчанию — текущая торговая сессия. `includeWeekends: true` — выходные
 * показываем как отдельные слоты (не схлопываем); схлопывание станет отдельным фильтром.
 */
const DEFAULT_TIMEFRAME: Timeframe = { kind: 'sessions', unit: 'D', count: 1, includeWeekends: true };

/** Ключ раскрытой опционной серии: `${futuresId}:${expiration}`. */
export const seriesKey = (futuresId: number, expiration: string): string =>
  `${futuresId}:${expiration}`;

export interface CoverageWindow {
  from: string;
  to: string;
}

/** Число месяцев в единице календарного таймфрейма (M/Q/Y). */
function monthsPerUnit(unit: TimeframeUnit): number {
  return unit === 'M' ? 1 : unit === 'Q' ? 3 : 12;
}

/** Сколько сессий охватывает посессионный таймфрейм D/W. */
function sessionCount(unit: 'D' | 'W', count: number, includeWeekends: boolean): number {
  const perWeek = includeWeekends ? SESSIONS_PER_WEEK.withWeekends : SESSIONS_PER_WEEK.workdays;
  return unit === 'D' ? count : count * perWeek;
}

/** Окно «сегодняшняя сессия» — начальное значение до подгрузки истории. */
function defaultWindow(now: number = Date.now()): CoverageWindow {
  const today = todaySession(now);
  return { from: new Date(today.startMs).toISOString(), to: new Date(today.endMs).toISOString() };
}

/**
 * Framework-agnostic доменный стор OHS (RxJS). Держит справочники и состояние записи как
 * BehaviorSubject-ы; REST-команды дергают {@link OhsApi} и обновляют сабджекты, а live-события
 * из `/ws` инкрементально правят состояние (рост колбасок без перезапроса).
 */
export class OhsStore {
  readonly instruments$ = new BehaviorSubject<InstrumentDto[]>([]);
  readonly instrumentsTotal$ = new BehaviorSubject<number>(0);
  readonly instrumentsLoading$ = new BehaviorSubject<boolean>(false);
  readonly instrumentQuery$ = new BehaviorSubject<InstrumentQueryParams>({
    limit: DEFAULT_PAGE_SIZE,
    offset: 0,
  });
  readonly selectedInstruments$ = new BehaviorSubject<ReadonlySet<number>>(new Set());

  /** Активные плашки-фильтры каталога (порядок = порядок добавления). */
  readonly activeFilters$ = new BehaviorSubject<FilterKey[]>([]);

  // --- Ленивое дерево деривативов: фьючерс → серии (экспирации) → страйки (опционы). ---
  readonly expandedFutures$ = new BehaviorSubject<ReadonlySet<number>>(new Set());
  readonly expandedSeries$ = new BehaviorSubject<ReadonlySet<string>>(new Set());
  readonly seriesByFutures$ = new BehaviorSubject<ReadonlyMap<number, InstrumentGroupDto[]>>(new Map());
  readonly strikesBySeries$ = new BehaviorSubject<ReadonlyMap<string, InstrumentDto[]>>(new Map());
  readonly sources$ = new BehaviorSubject<SourceDto[]>([]);
  readonly connections$ = new BehaviorSubject<ConnectionDto[]>([]);
  readonly recordings$ = new BehaviorSubject<RecordingDto[]>([]);
  readonly coverage$ = new BehaviorSubject<CoverageSegmentDto[]>([]);
  readonly window$ = new BehaviorSubject<CoverageWindow>(defaultWindow());

  // --- Таймфрейм и сессионное окно. ---
  readonly timeframe$ = new BehaviorSubject<Timeframe>(DEFAULT_TIMEFRAME);
  /** Границы сессий внутри окна (для сепараторов оси); пусто для M/Q/Y/All/range. */
  readonly sessions$ = new BehaviorSubject<SessionDto[]>([]);

  private liveSub?: Subscription;
  private windowTimer?: ReturnType<typeof setInterval>;
  private coveragePollTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly api: OhsApiClient = OhsApi,
    private readonly live: Observable<LiveEvent> = createLiveStream(),
  ) {}

  /** Загружает справочники, применяет таймфрейм и подписывается на live-поток. */
  start(): void {
    this.fetchInstruments(false);
    this.refreshSources();
    this.refreshConnections();
    this.refreshRecordings();
    this.applyTimeframe(this.timeframe$.value);
    this.liveSub = this.live.subscribe({
      next: (event) => this.onLive(event),
      error: (err) => console.error('live stream error', err),
    });

    // Периодический пересчёт окна ловит смену суток и рост экстента (для range — no-op).
    // Покрытие перезапрашивается чаще — свежие гэпы внутри активной сессии.
    this.windowTimer = setInterval(() => this.refreshTimeframeWindow(), WINDOW_REFRESH_MS);
    this.coveragePollTimer = setInterval(() => this.refreshCoverage(), COVERAGE_POLL_MS);
  }

  stop(): void {
    this.liveSub?.unsubscribe();
    if (this.windowTimer !== undefined) {
      clearInterval(this.windowTimer);
      this.windowTimer = undefined;
    }
    if (this.coveragePollTimer !== undefined) {
      clearInterval(this.coveragePollTimer);
      this.coveragePollTimer = undefined;
    }
  }

  /** Выбирает таймфрейм (чипы D/W/M/Q/Y, All, диапазон) и пересчитывает окно. */
  setTimeframe(timeframe: Timeframe): void {
    this.timeframe$.next(timeframe);
    this.applyTimeframe(timeframe);
  }

  /** Меняет единицу/глубину посессионного таймфрейма (например W2), сохраняя учёт выходных. */
  setSessionsTimeframe(unit: TimeframeUnit, count: number): void {
    const tf = this.timeframe$.value;
    const includeWeekends = tf.kind === 'sessions' || tf.kind === 'range' ? tf.includeWeekends : true;
    this.setTimeframe({ kind: 'sessions', unit, count, includeWeekends });
  }

  /** Переключает учёт выходных (влияет на счёт сессий D/W) и пересчитывает окно. */
  setIncludeWeekends(includeWeekends: boolean): void {
    const tf = this.timeframe$.value;
    if (tf.kind === 'sessions') {
      this.setTimeframe({ ...tf, includeWeekends });
    } else if (tf.kind === 'range') {
      this.setTimeframe({ ...tf, includeWeekends });
    }
  }

  /** Пересчёт окна для текущего таймфрейма (по таймеру); для range ничего не делает. */
  private refreshTimeframeWindow(): void {
    if (this.timeframe$.value.kind === 'range') {
      return;
    }
    this.applyTimeframe(this.timeframe$.value);
  }

  private applyTimeframe(timeframe: Timeframe): void {
    switch (timeframe.kind) {
      case 'sessions':
        this.applySessionsTimeframe(timeframe);
        break;
      case 'all':
        this.applyAllTimeframe();
        break;
      case 'range':
        this.applyRangeTimeframe(timeframe);
        break;
    }
  }

  private applySessionsTimeframe(
    tf: Extract<Timeframe, { kind: 'sessions' }>,
  ): void {
    const toMs = todaySession().endMs;

    // Календарные единицы (M/Q/Y) — сдвиг назад на n месяцев/кварталов/лет, но ось тоже
    // посессионная: каждый торговый день — доля, ночь/разрывы схлопнуты (как D/W, только длиннее).
    if (tf.unit === 'M' || tf.unit === 'Q' || tf.unit === 'Y') {
      const fromDate = shiftMonths(mskDateOf(), monthsPerUnit(tf.unit) * tf.count);
      const fromMs = sessionBounds(fromDate).startMs;
      const ordered = sessionsFrom(fromMs, tf.includeWeekends);
      this.sessions$.next(ordered);
      const leftMs = ordered.length > 0 ? Date.parse(ordered[0].start) : fromMs;
      this.setWindow({ from: new Date(leftMs).toISOString(), to: new Date(toMs).toISOString() });
      return;
    }

    // Посессионные (D/W): календарные сессии (выходные — отдельные слоты, не схлопываем).
    // Считаем локально — ось должна показывать и пустые выходные, которых нет в данных.
    const count = sessionCount(tf.unit, tf.count, tf.includeWeekends);
    const ordered = recentSessions(count, tf.includeWeekends);
    this.sessions$.next(ordered);
    const fromMs = ordered.length > 0 ? Date.parse(ordered[0].start) : todaySession().startMs;
    this.setWindow({ from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() });
  }

  private applyAllTimeframe(): void {
    const toMs = todaySession().endMs;
    this.sessions$.next([]);
    this.api.getCoverageExtent().subscribe({
      next: (extent) => {
        const fromMs = extent.from ? Date.parse(extent.from) : todaySession().startMs;
        const rightMs = Math.max(toMs, extent.to ? Date.parse(extent.to) : toMs);
        this.setWindow({ from: new Date(fromMs).toISOString(), to: new Date(rightMs).toISOString() });
      },
      error: (err) => {
        console.error('getCoverageExtent', err);
        this.setWindow(defaultWindow());
      },
    });
  }

  private applyRangeTimeframe(tf: Extract<Timeframe, { kind: 'range' }>): void {
    // Диапазон тоже посессионный: каждый день из [from, to] — своя доля (как D/W), без live.
    const aStart = sessionBounds(mskDateFromIso(tf.from)).startMs;
    const bEnd = sessionBounds(mskDateFromIso(tf.to)).endMs;
    const loMs = Math.min(aStart, bEnd);
    const hiMs = Math.max(aStart, bEnd);
    const ordered = sessionsFrom(loMs, tf.includeWeekends, hiMs);
    this.sessions$.next(ordered);
    const leftMs = ordered.length > 0 ? Date.parse(ordered[0].start) : loMs;
    const rightMs = ordered.length > 0 ? Date.parse(ordered[ordered.length - 1].end) : hiMs;
    this.setWindow({ from: new Date(leftMs).toISOString(), to: new Date(rightMs).toISOString() });
  }

  /** Переключает пометку инструмента; при активном условии «Выделенные» — пере-применяет фильтр. */
  toggleInstrumentSelection(instrumentId: number): void {
    const next = new Set(this.selectedInstruments$.value);
    if (next.has(instrumentId)) {
      next.delete(instrumentId);
    } else {
      next.add(instrumentId);
    }
    this.selectedInstruments$.next(next);

    if (this.instrumentQuery$.value.instrumentIds !== undefined) {
      this.setInstrumentFilter({ instrumentIds: [...next] });
    }
  }

  /** Добавляет плашку-фильтр (если ещё не добавлена). Значения выбираются в поповере. */
  addFilter(key: FilterKey): void {
    if (this.activeFilters$.value.includes(key)) {
      return;
    }
    this.activeFilters$.next([...this.activeFilters$.value, key]);
  }

  /** Убирает плашку и очищает относящиеся к ней поля запроса. */
  removeFilter(key: FilterKey): void {
    this.activeFilters$.next(this.activeFilters$.value.filter((k) => k !== key));
    this.setInstrumentFilter(this.clearedFieldsFor(key));
  }

  /** Сбрасывает все плашки и фильтр-поля запроса (поиск не трогаем). */
  clearFilters(): void {
    this.activeFilters$.next([]);
    this.setInstrumentFilter({
      category: undefined,
      onlyRecording: undefined,
      nonEmpty: undefined,
      instrumentIds: undefined,
      exchanges: undefined,
    });
  }

  /** Категория плашки «Инструменты» (пусто → все). */
  setCategory(category: string | undefined): void {
    this.setInstrumentFilter({ category: category || undefined });
  }

  /** Биржи плашки «Биржи» (пусто → без фильтра). */
  setExchanges(exchanges: string[]): void {
    this.setInstrumentFilter({ exchanges: exchanges.length > 0 ? exchanges : undefined });
  }

  /** Текущие условия плашки «Выбор» (проекция query-полей). */
  selectionConditions(): SelectionConditions {
    const q = this.instrumentQuery$.value;
    return {
      recording: Boolean(q.onlyRecording),
      nonEmpty: Boolean(q.nonEmpty),
      selected: q.instrumentIds !== undefined,
    };
  }

  /** Применяет условия плашки «Выбор» (комбинируются по И). */
  setSelectionConditions(conditions: SelectionConditions): void {
    this.setInstrumentFilter({
      onlyRecording: conditions.recording ? true : undefined,
      nonEmpty: conditions.nonEmpty ? true : undefined,
      instrumentIds: conditions.selected ? [...this.selectedInstruments$.value] : undefined,
    });
  }

  /** Патч query-полей для очистки при снятии плашки. */
  private clearedFieldsFor(key: FilterKey): Partial<InstrumentQueryParams> {
    switch (key) {
      case 'instruments':
        return { category: undefined };
      case 'selection':
        return { onlyRecording: undefined, nonEmpty: undefined, instrumentIds: undefined };
      case 'exchanges':
        return { exchanges: undefined };
    }
  }

  /** Меняет фильтр каталога (сбрасывает offset + дерево) и перезагружает первую страницу. */
  setInstrumentFilter(patch: Partial<InstrumentQueryParams>): void {
    this.instrumentQuery$.next({ ...this.instrumentQuery$.value, ...patch, offset: 0 });
    this.collapseTree();
    this.fetchInstruments(false);
  }

  private collapseTree(): void {
    this.expandedFutures$.next(new Set());
    this.expandedSeries$.next(new Set());
  }

  /** Раскрывает/сворачивает фьючерс; при первом раскрытии лениво грузит серии. */
  toggleFutures(instrument: InstrumentDto): void {
    const next = new Set(this.expandedFutures$.value);
    if (next.has(instrument.instrumentId)) {
      next.delete(instrument.instrumentId);
    } else {
      next.add(instrument.instrumentId);
      if (!this.seriesByFutures$.value.has(instrument.instrumentId)) {
        this.loadSeries(instrument.instrumentId);
      }
    }
    this.expandedFutures$.next(next);
  }

  /** Раскрывает/сворачивает серию; при первом раскрытии лениво грузит страйки. */
  toggleSeries(futuresId: number, expiration: string): void {
    const key = seriesKey(futuresId, expiration);
    const next = new Set(this.expandedSeries$.value);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      if (!this.strikesBySeries$.value.has(key)) {
        this.loadStrikes(futuresId, expiration);
      }
    }
    this.expandedSeries$.next(next);
  }

  private loadSeries(futuresId: number): void {
    this.api.getInstrumentSeries(futuresId).subscribe({
      next: (series) => {
        const map = new Map(this.seriesByFutures$.value);
        map.set(futuresId, series);
        this.seriesByFutures$.next(map);
      },
      error: (err) => console.error('getInstrumentSeries', err),
    });
  }

  private loadStrikes(futuresId: number, expiration: string): void {
    this.api
      .getInstruments({ underlyingId: futuresId, expiration, secType: 'OPT', limit: 500, offset: 0 })
      .subscribe({
        next: (page) => {
          const map = new Map(this.strikesBySeries$.value);
          map.set(seriesKey(futuresId, expiration), page.items);
          this.strikesBySeries$.next(map);
        },
        error: (err) => console.error('loadStrikes', err),
      });
  }

  /** Догружает следующую страницу каталога (infinite scroll). */
  loadMoreInstruments(): void {
    if (this.instrumentsLoading$.value) {
      return;
    }
    if (this.instruments$.value.length >= this.instrumentsTotal$.value) {
      return;
    }
    this.instrumentQuery$.next({
      ...this.instrumentQuery$.value,
      offset: this.instruments$.value.length,
    });
    this.fetchInstruments(true);
  }

  private fetchInstruments(append: boolean): void {
    if (this.instrumentsLoading$.value) {
      return;
    }
    this.instrumentsLoading$.next(true);
    this.api.getInstruments(this.instrumentQuery$.value).subscribe({
      next: (page) => {
        this.instrumentsTotal$.next(page.total);
        this.instruments$.next(append ? [...this.instruments$.value, ...page.items] : page.items);
        this.instrumentsLoading$.next(false);
      },
      error: (err) => {
        console.error('getInstruments', err);
        this.instrumentsLoading$.next(false);
      },
    });
  }

  refreshSources(): void {
    this.api.getSources().subscribe({
      next: (x) => this.sources$.next(x),
      error: (err) => console.error('getSources', err),
    });
  }

  refreshConnections(): void {
    this.api.getConnections().subscribe({
      next: (x) => this.connections$.next(x),
      error: (err) => console.error('getConnections', err),
    });
  }

  refreshRecordings(): void {
    this.api.getRecordings().subscribe({
      next: (x) => this.recordings$.next(x),
      error: (err) => console.error('getRecordings', err),
    });
  }

  refreshCoverage(): void {
    const { from, to } = this.window$.value;
    this.api.getCoverage(from, to).subscribe({
      next: (x) => this.coverage$.next(x),
      error: (err) => console.error('getCoverage', err),
    });
  }

  setWindow(window: CoverageWindow): void {
    this.window$.next(window);
    this.refreshCoverage();
  }

  connect(connectionId: number): void {
    this.api.connect(connectionId).subscribe({
      next: (c) => this.upsertConnection(c),
      error: (err) => console.error('connect', err),
    });
  }

  disconnect(connectionId: number): void {
    this.api.disconnect(connectionId).subscribe({
      next: (c) => this.upsertConnection(c),
      error: (err) => console.error('disconnect', err),
    });
  }

  startRecording(request: StartRecordingRequest): void {
    this.api.startRecording(request).subscribe({
      next: () => {
        this.refreshRecordings();
        this.refreshCoverage();
      },
      error: (err) => console.error('startRecording', err),
    });
  }

  stopRecording(instrumentId: number): void {
    this.api.stopRecording(instrumentId).subscribe({
      next: () => {
        this.refreshRecordings();
        this.refreshCoverage();
      },
      error: (err) => console.error('stopRecording', err),
    });
  }

  /** Инкрементально применяет live-событие к состоянию. */
  onLive(event: LiveEvent): void {
    switch (event.type) {
      case 'connectionStatusChanged':
        this.connections$.next(
          this.connections$.value.map((c) =>
            c.connectionId === event.connectionId ? { ...c, status: event.status } : c,
          ),
        );
        break;

      case 'coverageExtended':
        this.applyCoverageExtended(event.instrumentId, event.sourceId, event.tradeCount);
        break;

      case 'recordingStarted':
        this.refreshRecordings();
        this.refreshCoverage();
        break;

      case 'recordingStopped':
        this.refreshRecordings();
        this.refreshCoverage();
        break;
    }
  }

  private applyCoverageExtended(instrumentId: number, sourceId: number, tradeCount: number): void {
    // Обновляем счётчик активной записи (плавный рост без перезапроса).
    this.recordings$.next(
      this.recordings$.value.map((r) =>
        r.instrumentId === instrumentId && r.sourceId === sourceId ? { ...r, tradeCount } : r,
      ),
    );

    // Двигаем правый край активной колбаски (ended_at == null).
    this.coverage$.next(
      this.coverage$.value.map((s) =>
        s.instrumentId === instrumentId && s.sourceId === sourceId && s.to === null
          ? { ...s, tradeCount }
          : s,
      ),
    );

    // Если активного сегмента ещё нет в окне — подтягиваем coverage.
    const hasActive = this.coverage$.value.some(
      (s) => s.instrumentId === instrumentId && s.sourceId === sourceId && s.to === null,
    );
    if (!hasActive) {
      this.refreshCoverage();
    }
  }

  private upsertConnection(connection: ConnectionDto): void {
    const exists = this.connections$.value.some((c) => c.connectionId === connection.connectionId);
    this.connections$.next(
      exists
        ? this.connections$.value.map((c) =>
            c.connectionId === connection.connectionId ? connection : c,
          )
        : [...this.connections$.value, connection],
    );
  }
}
