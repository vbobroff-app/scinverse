import { BehaviorSubject, type Observable, type Subscription } from 'rxjs';
import { OhsApi, type OhsApiClient } from './api';
import { createLiveStream } from './live';
import type {
  ConnectionDto,
  CoverageSegmentDto,
  InstrumentDto,
  InstrumentQueryParams,
  LiveEvent,
  RecordingDto,
  SourceDto,
  StartRecordingRequest,
} from './types';

const DEFAULT_PAGE_SIZE = 100;

export interface CoverageWindow {
  from: string;
  to: string;
}

function defaultWindow(): CoverageWindow {
  const now = Date.now();
  return {
    from: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    to: new Date(now + 2 * 60 * 1000).toISOString(),
  };
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
  readonly sources$ = new BehaviorSubject<SourceDto[]>([]);
  readonly connections$ = new BehaviorSubject<ConnectionDto[]>([]);
  readonly recordings$ = new BehaviorSubject<RecordingDto[]>([]);
  readonly coverage$ = new BehaviorSubject<CoverageSegmentDto[]>([]);
  readonly window$ = new BehaviorSubject<CoverageWindow>(defaultWindow());

  private liveSub?: Subscription;

  constructor(
    private readonly api: OhsApiClient = OhsApi,
    private readonly live: Observable<LiveEvent> = createLiveStream(),
  ) {}

  /** Загружает справочники, открывает coverage-окно и подписывается на live-поток. */
  start(): void {
    this.fetchInstruments(false);
    this.refreshSources();
    this.refreshConnections();
    this.refreshRecordings();
    this.refreshCoverage();
    this.liveSub = this.live.subscribe({
      next: (event) => this.onLive(event),
      error: (err) => console.error('live stream error', err),
    });
  }

  stop(): void {
    this.liveSub?.unsubscribe();
  }

  /** Переключает пометку инструмента (для будущего фильтра «по выбранным»). */
  toggleInstrumentSelection(instrumentId: number): void {
    const next = new Set(this.selectedInstruments$.value);
    if (next.has(instrumentId)) {
      next.delete(instrumentId);
    } else {
      next.add(instrumentId);
    }
    this.selectedInstruments$.next(next);
  }

  /** Меняет фильтр каталога (сбрасывает offset) и перезагружает первую страницу. */
  setInstrumentFilter(patch: Partial<InstrumentQueryParams>): void {
    this.instrumentQuery$.next({ ...this.instrumentQuery$.value, ...patch, offset: 0 });
    this.fetchInstruments(false);
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
