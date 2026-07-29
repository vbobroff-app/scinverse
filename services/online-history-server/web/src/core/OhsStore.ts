import { BehaviorSubject, EMPTY, from, of, throwError, type Observable, type Subscription } from 'rxjs';
import { notify } from '@scinverse/notification-center';
import { notificationBus } from './notifications';
import { catchError, finalize, map, mergeMap, switchMap, tap, timeout, toArray } from 'rxjs/operators';
import { bucketSecondsForTimeframe } from './activityBucket';
import { OhsApi, type OhsApiClient } from './api';
import { isConnectedNow } from './connectionSchedule';
import { gapsFromLivenessIntervals, overlayCrashOutageOnLink } from './coverageGeometry';
import { createLiveStream, linkStateToConnectionStatus } from './live';
import { loadSelectedInstruments, persistSelectedInstruments } from './selectedInstrumentsStorage';
import { loadViewState, persistViewState, type PersistedSeries } from './viewStateStorage';
import { DEFAULT_SECTION, type NavSectionId } from './navigation';
import {
  mskDateFromIso,
  mskDateOf,
  mergeSessionHours,
  mskMidnightMsFromIso,
  recentSessions,
  sessionBounds,
  sessionsFrom,
  shiftMonths,
  todaySession,
  weekdayOfIso,
} from './moexSession';
import type {
  CaptureGapDto,
  ConnectionDto,
  CoverageSegmentDto,
  DisplayTz,
  FilterKey,
  InstrumentDto,
  InstrumentGroupDto,
  InstrumentQueryParams,
  IncidentDto,
  LivenessIntervalDto,
  LiveEvent,
  NotificationDto,
  ConnectionScheduleStateDto,
  PutConnectionScheduleRuleRequest,
  ScheduleComposeItemDto,
  RecordingDto,
  RecordingScheduleDto,
  SelectionScope,
  SessionDto,
  SessionWindowMode,
  SourceDto,
  StartRecordingRequest,
  Timeframe,
  TimeframeUnit,
  TimelineFilter,
  UpsertConnectionRequest,
  ValidateConnectionResult,
} from './types';

/** Сейчас внутри торговой сессии из sessions$ (MOEX / ISS). */
export function isInTradingSession(sessions: readonly SessionDto[], nowMs: number): boolean {
  return sessions.some((s) => {
    const start = Date.parse(s.start);
    const end = Date.parse(s.end);
    return Number.isFinite(start) && Number.isFinite(end) && nowMs >= start && nowMs <= end;
  });
}
/** Флаги условий плашки «Выбор» (проекция query-параметров для чек-листа). */
export interface SelectionConditions {
  recording: boolean;
  nonEmpty: boolean;
  selected: boolean;
}

const DEFAULT_SELECTION_SCOPE: SelectionScope = 'all';

/**
 * Слой сделок (phase 7g): присутствие сделок по бакетам. `bucketMs` — текущий шаг бакета (из
 * таймфрейма, для геометрии ячеек); `byInstrument` — старты непустых бакетов (ms) на инструмент.
 * Отсутствие бакета = разрыв (нейтрально; классификация тихо/обрыв — phase 7h).
 */
export interface TradeActivityState {
  bucketMs: number;
  byInstrument: ReadonlyMap<number, number[]>;
}

/** Живость захвата + журнал разрывов (phase 7h) на подключение (source). */
export interface LivenessState {
  intervals: LivenessIntervalDto[];
  gaps: CaptureGapDto[];
}

/** Жизненный цикл связи + периоды «связь не жива» (лента Connection, phase 7h.8) на подключение (source). */
export interface LinkLivenessState {
  intervals: LivenessIntervalDto[];
  gaps: CaptureGapDto[];
  /** T (сек) для clamp жёлтой фазы; с `/coverage/link`. */
  linkRecoverGraceSeconds?: number;
  /**
   * Эпизоды журнала `incident` для окна (11.13e). `undefined` — ещё не грузили / сброс
   * (лента Connection в legacy-режиме gaps); массив — источник цветных эпизодов + Recording red.
   */
  incidents?: IncidentDto[];
}

/** Контекст запроса слоя сделок: какие инструменты и по какому источнику сейчас видно. */
interface ActivityContext {
  instrumentIds: readonly number[];
  sourceId: number;
}

const DEFAULT_PAGE_SIZE = 100;

/** Максимум параллельных стартов/остановок при записи всей опционной серии. */
const SERIES_CONCURRENCY = 6;
/** Потолок числа страйков, подтягиваемых для серии (одна страница). */
const SERIES_STRIKES_LIMIT = 500;

/** Как часто перезапрашивать покрытие (живые гэпы внутри активной сессии). */
const COVERAGE_POLL_MS = 12_000;
/** Grace до объявления недоступности бэка (7j.20): глушим тривиальные блипы WS (HMR/быстрый рестарт). */
const BACKEND_OUTAGE_GRACE_MS = 6_000;
/** Каденция живых тиков длительности простоя (error-фаза). */
const BACKEND_OUTAGE_TICK_MS = 5_000;
/** Settle после re-open: столько связь должна продержаться (без нового дропа) → warning→ok. */
const BACKEND_OUTAGE_SETTLE_MS = 5_000;
/** Кулдаун нестабильности: после втянутого в стек `ohs.unhandled` (500) ждём столько без нового 500 →
 * повторная попытка восстановления (warning→settle→ok). Каждый новый 500 сбрасывает кулдаун. */
const BACKEND_OUTAGE_UNSTABLE_COOLDOWN_MS = 5_000;
/** Окно adopt (§9.3): дроп WS в пределах стольки после одиночного 500 → инцидент наследует его corr
 * (весь стек в одной нити: 500 → open → … → resolved), а не заводит свой `ohs.backend.outage:<ts>`. */
const BACKEND_FATAL_ADOPT_WINDOW_MS = 15_000;
/** Пока инцидент open/warning — долбим holdRecovery, пока бэк не примет (§9.2): иначе 500 через swagger
 * до первого WS-reconnect уходит под requestId (вне стека). */
const BACKEND_OUTAGE_HOLD_RETRY_MS = 2_000;
/** Как часто пересчитывать окно (ловим смену суток/рост экстента; для range — no-op). */
const WINDOW_REFRESH_MS = 60_000;
/** Сколько сессий в неделе при выключенных/включённых выходных. */
const SESSIONS_PER_WEEK = { workdays: 5, withWeekends: 7 } as const;
/**
 * Таймфрейм по умолчанию — текущая торговая сессия. `includeWeekends: true` — выходные
 * показываем как отдельные слоты (не схлопываем); схлопывание станет отдельным фильтром.
 */
const DEFAULT_TIMEFRAME: Timeframe = { kind: 'sessions', unit: 'D', count: 1, includeWeekends: true };

const DAY_MS = 24 * 60 * 60 * 1000;
/** Все дни недели (0=вс..6=сб). */
const ALL_WEEKDAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
/** Домашняя биржа (расписание по умолчанию, пока мультибиржа не наполнена). */
const HOME_EXCHANGE = 'MOEX';
/** Движок ISS для часов сессии MOEX/FORTS (см. GET /api/sessions?engine=). */
const HOME_ENGINE = 'futures';
/** Стартовый пресет: все дни, сессия MOEX (свёрнутая, как раньше), полные сутки выключены. */
const STARTUP_TIMELINE: TimelineFilter = {
  weekdays: new Set(ALL_WEEKDAYS),
  fullDay: false,
  session: { mode: 'session', exchange: HOME_EXCHANGE },
};
/** Нейтраль тайм-лайн-фильтра: все дни, полные сутки, сессия не выбрана. */
const NEUTRAL_TIMELINE: TimelineFilter = {
  weekdays: new Set(ALL_WEEKDAYS),
  fullDay: true,
  session: { mode: 'none' },
};
/** Стандарт времени по умолчанию — МСК (UTC+3). */
const DEFAULT_DISPLAY_TZ: DisplayTz = { preset: 'msk', offsetMin: 180 };

/**
 * Пере-строение границ дня под тайм-лайн-фильтр. `mode` уже разрешён (без `smart`).
 *
 * - сессия не выбрана (`none`) → полные сутки одной колбаской `[00:00, 24:00]`;
 * - сессия выбрана, `fullDay=false` → сворачиваем день до окна сессии (одна колбаска);
 * - сессия выбрана, `fullDay=true` → полные сутки + границы сессии в `sessionStart/End`
 *   (рендерятся как зоны `[pre | session | post]`).
 *
 * Для `session` границы `sessionStart/End` — из `SessionDto` (D/W: часы ISS с бэка).
 */
function reshapeDay(session: SessionDto, fullDay: boolean, mode: SessionWindowMode): SessionDto {
  const midnight = mskMidnightMsFromIso(session.date);
  const dayStart = new Date(midnight).toISOString();
  const dayEnd = new Date(midnight + DAY_MS).toISOString();

  let ss: string | null = null;
  let se: string | null = null;
  switch (mode.mode) {
    case 'session':
    case 'smart': // разрешается в resolveSession; сюда `smart` не доходит
      ss = session.start;
      se = session.end;
      break;
    case 'custom':
      ss = new Date(midnight + mode.fromMin * 60_000).toISOString();
      se = new Date(midnight + mode.toMin * 60_000).toISOString();
      break;
    case 'none':
      break;
  }

  if (!ss || !se) {
    return { ...session, start: dayStart, end: dayEnd, sessionStart: undefined, sessionEnd: undefined };
  }
  if (!fullDay) {
    return { ...session, start: ss, end: se, sessionStart: undefined, sessionEnd: undefined };
  }
  return { ...session, start: dayStart, end: dayEnd, sessionStart: ss, sessionEnd: se };
}

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
  readonly selectedInstruments$ = new BehaviorSubject<ReadonlySet<number>>(loadSelectedInstruments());

  /** Активные плашки-фильтры каталога (порядок = порядок добавления). */
  readonly activeFilters$ = new BehaviorSubject<FilterKey[]>([]);

  // --- Ленивое дерево деривативов: фьючерс → серии (экспирации) → страйки (опционы). ---
  readonly expandedFutures$ = new BehaviorSubject<ReadonlySet<number>>(new Set());
  readonly expandedSeries$ = new BehaviorSubject<ReadonlySet<string>>(new Set());
  readonly seriesByFutures$ = new BehaviorSubject<ReadonlyMap<number, InstrumentGroupDto[]>>(new Map());
  readonly strikesBySeries$ = new BehaviorSubject<ReadonlyMap<string, InstrumentDto[]>>(new Map());
  /**
   * Spine выделенных/совпавших опционов: futuresId → экспирации серий.
   * Заполняется при scope «ко всем»; UI режет дерево до этих веток.
   */
  readonly selectedOptionSpine$ = new BehaviorSubject<ReadonlyMap<number, ReadonlySet<string>>>(new Map());
  /** Листья-опционы, попавшие в фильтр «Выбор» при scope «ко всем» (для prune страйков). */
  readonly selectionLeafIds$ = new BehaviorSubject<ReadonlySet<number>>(new Set());
  /** Область применения «Выбор»: ко всем / только к БА. */
  readonly selectionScope$ = new BehaviorSubject<SelectionScope>(DEFAULT_SELECTION_SCOPE);
  /** Ключи серий, по которым сейчас идёт массовый старт/стоп записи (для блокировки кнопки). */
  readonly seriesBusy$ = new BehaviorSubject<ReadonlySet<string>>(new Set());
  readonly sources$ = new BehaviorSubject<SourceDto[]>([]);
  readonly connections$ = new BehaviorSubject<ConnectionDto[]>([]);
  readonly recordings$ = new BehaviorSubject<RecordingDto[]>([]);
  /** Политики автозаписи: instrumentId → schedule. */
  readonly recordingSchedule$ = new BehaviorSubject<ReadonlyMap<number, RecordingScheduleDto>>(new Map());

  /** Состояния расписаний соединений (connectionId → settings + правила), phase 7j v2. */
  readonly connectionSchedule$ = new BehaviorSubject<ReadonlyMap<number, ConnectionScheduleStateDto>>(new Map());
  /**
   * Crash-outage в фазе open: маска тумблеров «OHS недоступен» / AUTO жёлтый.
   * grace — без маски (HMR); warning/resolved — маска снята, снова connection.status.
   */
  readonly backendOutage$ = new BehaviorSubject(false);
  readonly coverage$ = new BehaviorSubject<CoverageSegmentDto[]>([]);
  readonly window$ = new BehaviorSubject<CoverageWindow>(defaultWindow());

  /** Слой сделок: присутствие по бакетам для видимых инструментов (см. setActivityContext). */
  readonly activity$ = new BehaviorSubject<TradeActivityState>({ bucketMs: 30_000, byInstrument: new Map() });
  /** Живость захвата и разрывы связи (честная подложка, phase 7h). */
  readonly liveness$ = new BehaviorSubject<LivenessState>({ intervals: [], gaps: [] });
  /** Жизненный цикл связи (лента Connection, phase 7h.8) — история связи независимо от записи. */
  readonly link$ = new BehaviorSubject<LinkLivenessState>({ intervals: [], gaps: [] });
  /** Что запрашивать в слое сделок; задаётся UI (видимые строки + источник провайдера). */
  private activityContext: ActivityContext | null = null;
  /** Источник провайдера для живости захвата (один на подключение). */
  private livenessSourceId: number | null = null;

  // --- Таймфрейм и сессионное окно. ---
  readonly timeframe$ = new BehaviorSubject<Timeframe>(DEFAULT_TIMEFRAME);
  /** Границы сессий внутри окна (для сепараторов оси); пусто для M/Q/Y/All/range. */
  readonly sessions$ = new BehaviorSubject<SessionDto[]>([]);
  /** Тайм-лайн-фильтр оси: дни недели + окно дня (клиентская пере-проекция). */
  readonly timelineFilter$ = new BehaviorSubject<TimelineFilter>(STARTUP_TIMELINE);
  /** Стандарт времени отображения — единый на всю систему (ось/тултипы). */
  readonly displayTz$ = new BehaviorSubject<DisplayTz>(DEFAULT_DISPLAY_TZ);

  /** Активный раздел верхнего уровня (левый рейл): провайдеры/биржи/новости/… */
  readonly activeSection$ = new BehaviorSubject<NavSectionId>(DEFAULT_SECTION);

  /** Выбранный провайдер в разделе «Провайдеры» (переживает переход между разделами и перезагрузку). */
  readonly activeConnectionId$ = new BehaviorSubject<number | null>(null);

  /** Тумблер вертикального time-line (crosshair) над Гантом (сохраняется). */
  readonly crosshairOn$ = new BehaviorSubject<boolean>(true);
  /** Тумблер подсветки границ дней над Гантом (сохраняется). */
  readonly highlightDays$ = new BehaviorSubject<boolean>(false);
  /** Показывать панель фильтров каталога (шестерёнка провайдера, сохраняется). */
  readonly showFilters$ = new BehaviorSubject<boolean>(true);

  /** Раскрытые серии, ожидающие регидрации после перезагрузки (одноразово, см. hydrateExpanded). */
  private pendingSeriesHydration: PersistedSeries[] = [];

  private liveSub?: Subscription;
  private windowTimer?: ReturnType<typeof setInterval>;
  private coveragePollTimer?: ReturnType<typeof setInterval>;

  // Инцидент недоступности бэка (7j.20). Фазы: grace → open (FATAL+тики) → warning → ok.
  // §9.2: к OK только через WARNING (не FATAL→OK). Пачка mid-stack 500 → один warn после кулдауна.
  // outageStart (часы клиента) = момент дропа = backdated начало. null ⇒ инцидента нет.
  private outageStart: number | null = null;
  private outagePhase: 'none' | 'grace' | 'open' | 'warning' = 'none';
  private outageGraceTimer?: ReturnType<typeof setTimeout>;
  private outageTickTimer?: ReturnType<typeof setInterval>;
  private outageSettleTimer?: ReturnType<typeof setTimeout>;
  // Кулдаун после 500/пачки: без нового 500 → warn (один на пачку) → settle → ok.
  private outageRecoverTimer?: ReturnType<typeof setTimeout>;
  // Heads-up барьеру бэка принят (holdRecovery 2xx) — ActiveCorrelationId на бэке.
  private outageHeldSignaled = false;
  private outageHoldInFlight = false;
  private outageHoldTimer?: ReturnType<typeof setInterval>;
  // corr инцидента (§9.2): cold = `ohs.backend.outage:<startMs>`; adopt = requestId 500.
  private outageCorr: string | null = null;
  // true после open/500/дропа из warning — пока не эмитнули recovering; resolve без warn запрещён.
  private outageNeedsWarnBeforeOk = false;
  // Одиночный 500 без инцидента (§9.3): corr/время для health-probe и adopt при дропе.
  private pendingFatalCorr: string | null = null;
  private pendingFatalAt: number | null = null;
  /** Кэш desired расписания на время crash-outage — ловим спад true→false → abandoned_schedule. */
  private outageScheduleDesired: boolean | null = null;
  /**
   * После schedule-end close: [FATAL open, WARNING incident_closed] ждут mock-POST, пока бэк мёртв
   * (как open+resolve при recovered). По оживлении — flush, без зелёного `backend.recovered`.
   */
  private pendingOutagePersist: NotificationDto[] | null = null;
  /** Последний `backend.recovering` — в шину сразу, в БД только вместе с open+recovered (анти-сирота). */
  private pendingRecoveringDto: NotificationDto | null = null;

  constructor(
    private readonly api: OhsApiClient = OhsApi,
    private readonly live?: Observable<LiveEvent>,
  ) {
    this.restoreViewState();
  }

  /**
   * Восстанавливает представление каталога из localStorage: активный провайдер, плашки-фильтры,
   * поля запроса и раскрытые узлы дерева. Список выделенных инструментов уже поднят в
   * {@link selectedInstruments$}; здесь по флагу `selected` включаем соответствующий фильтр.
   */
  private restoreViewState(): void {
    const v = loadViewState();
    this.activeConnectionId$.next(v.activeConnectionId);
    this.activeFilters$.next(v.activeFilters);
    this.instrumentQuery$.next({
      ...this.instrumentQuery$.value,
      category: v.category,
      onlyRecording: v.onlyRecording,
      nonEmpty: v.nonEmpty,
      exchanges: v.exchanges,
      instrumentIds: v.selected ? [...this.selectedInstruments$.value] : undefined,
      includeOptionAncestors: (v.selectionScope ?? DEFAULT_SELECTION_SCOPE) !== 'base',
    });
    this.selectionScope$.next(v.selectionScope ?? DEFAULT_SELECTION_SCOPE);
    this.expandedFutures$.next(new Set(v.expandedFutures));
    this.expandedSeries$.next(new Set(v.expandedSeries.map((s) => seriesKey(s.futuresId, s.expiration))));
    this.pendingSeriesHydration = v.expandedSeries;
    if (v.timeframe) {
      this.timeframe$.next(v.timeframe);
    }
    if (v.timeline) {
      this.timelineFilter$.next({
        weekdays: new Set(v.timeline.weekdays),
        fullDay: v.timeline.fullDay,
        session: v.timeline.session,
      });
    }
    if (v.displayTz) {
      this.displayTz$.next(v.displayTz);
    }
    if (typeof v.crosshair === 'boolean') {
      this.crosshairOn$.next(v.crosshair);
    }
    if (typeof v.highlightDays === 'boolean') {
      this.highlightDays$.next(v.highlightDays);
    }
    if (typeof v.showFilters === 'boolean') {
      this.showFilters$.next(v.showFilters);
    }
  }

  /** Снимок представления каталога для localStorage (из текущих сабджектов). */
  private persistView(): void {
    const q = this.instrumentQuery$.value;
    const expandedSeries: PersistedSeries[] = [...this.expandedSeries$.value].flatMap((key) => {
      const sep = key.indexOf(':');
      const futuresId = Number(key.slice(0, sep));
      const expiration = key.slice(sep + 1);
      return Number.isFinite(futuresId) && expiration ? [{ futuresId, expiration }] : [];
    });
    persistViewState({
      activeConnectionId: this.activeConnectionId$.value,
      activeFilters: [...this.activeFilters$.value],
      category: q.category,
      onlyRecording: q.onlyRecording,
      nonEmpty: q.nonEmpty,
      selected: q.instrumentIds !== undefined,
      selectionScope: this.selectionScope$.value,
      exchanges: q.exchanges,
      expandedFutures: [...this.expandedFutures$.value],
      expandedSeries,
      timeframe: this.timeframe$.value,
      timeline: {
        weekdays: [...this.timelineFilter$.value.weekdays],
        fullDay: this.timelineFilter$.value.fullDay,
        session: this.timelineFilter$.value.session,
      },
      displayTz: this.displayTz$.value,
      crosshair: this.crosshairOn$.value,
      highlightDays: this.highlightDays$.value,
      showFilters: this.showFilters$.value,
    });
  }

  /** Выбирает провайдера в разделе «Провайдеры» (с сохранением между сессиями). */
  setActiveConnection(connectionId: number | null): void {
    if (this.activeConnectionId$.value !== connectionId) {
      this.activeConnectionId$.next(connectionId);
      this.persistView();
      // 11.13e: журнал инцидентов привязан к connectionId, не только к sourceId.
      this.refreshLiveness();
    }
  }

  /**
   * Дозагружает серии/страйки для узлов дерева, раскрытых в прошлой сессии (после перезагрузки
   * данные дерева пусты). Идемпотентно: грузит только отсутствующее в кэше.
   */
  private hydrateExpanded(): void {
    for (const futuresId of this.expandedFutures$.value) {
      if (!this.seriesByFutures$.value.has(futuresId)) {
        this.loadSeries(futuresId);
      }
    }
    for (const { futuresId, expiration } of this.pendingSeriesHydration) {
      if (!this.strikesBySeries$.value.has(seriesKey(futuresId, expiration))) {
        this.loadStrikes(futuresId, expiration);
      }
    }
    this.pendingSeriesHydration = [];
  }

  /** Загружает справочники, применяет таймфрейм и подписывается на live-поток. */
  start(): void {
    this.fetchInstruments(false);
    this.hydrateExpanded();
    this.refreshSources();
    this.refreshConnections();
    this.refreshRecordings();
    this.refreshRecordingSchedule();
    this.refreshNotifications();
    this.applyTimeframe(this.timeframe$.value);
    const stream =
      this.live ??
      createLiveStream(
        undefined,
        () => {
          this.refreshConnections();
          this.refreshRecordings();
          this.refreshCoverage();
          this.refreshLiveness();
          this.onBackendReachable();
        },
        () => this.onBackendDrop(),
      );
    this.liveSub = stream.subscribe({
      next: (event) => this.onLive(event),
      error: (err) => console.error('live stream error', err),
    });

    // Периодический пересчёт окна ловит смену суток и рост экстента (для range — no-op).
    // Покрытие перезапрашивается чаще — свежие гэпы внутри активной сессии.
    this.windowTimer = setInterval(() => this.refreshTimeframeWindow(), WINDOW_REFRESH_MS);
    this.coveragePollTimer = setInterval(() => {
      this.refreshCoverage();
      this.refreshActivity();
      this.refreshLiveness();
    }, COVERAGE_POLL_MS);
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
    this.clearOutageTimers();
  }

  private clearOutageTimers(): void {
    if (this.outageGraceTimer !== undefined) {
      clearTimeout(this.outageGraceTimer);
      this.outageGraceTimer = undefined;
    }
    if (this.outageTickTimer !== undefined) {
      clearInterval(this.outageTickTimer);
      this.outageTickTimer = undefined;
    }
    if (this.outageSettleTimer !== undefined) {
      clearTimeout(this.outageSettleTimer);
      this.outageSettleTimer = undefined;
    }
    if (this.outageRecoverTimer !== undefined) {
      clearTimeout(this.outageRecoverTimer);
      this.outageRecoverTimer = undefined;
    }
    this.stopHoldRetry();
    this.outageHoldInFlight = false;
  }

  /** Синхронизирует фазу outage и флаг маски тумблеров (только open → true). */
  private setOutagePhase(phase: 'none' | 'grace' | 'open' | 'warning'): void {
    this.outagePhase = phase;
    const mask = phase === 'open';
    if (this.backendOutage$.value !== mask) {
      this.backendOutage$.next(mask);
    }
  }

  private stopHoldRetry(): void {
    if (this.outageHoldTimer !== undefined) {
      clearInterval(this.outageHoldTimer);
      this.outageHoldTimer = undefined;
    }
  }

  /**
   * §9.2: заявить бэку corr открытого инцидента как можно раньше (не ждать warning). Пока бэк лежит —
   * запросы падают, ретраим с фазы open; как только 2xx — `ActiveCorrelationId` штампует `ohs.unhandled`.
   * `outageHeldSignaled` только после успеха (раньше ставили до ответа → один фейл = hold навсегда).
   */
  private signalHoldRecovery(): void {
    if (this.outageHeldSignaled || this.outageCorr === null || this.outageHoldInFlight) {
      return;
    }
    const corr = this.outageCorr;
    this.outageHoldInFlight = true;
    this.api.holdRecovery(corr).subscribe({
      next: () => {
        this.outageHoldInFlight = false;
        this.outageHeldSignaled = true;
        this.stopHoldRetry();
      },
      error: () => {
        this.outageHoldInFlight = false;
        this.ensureHoldRetry();
      },
    });
  }

  private ensureHoldRetry(): void {
    if (this.outageHeldSignaled || this.outageHoldTimer !== undefined) {
      return;
    }
    this.outageHoldTimer = setInterval(() => {
      if (this.outageHeldSignaled || this.outageStart === null || this.outageCorr === null) {
        this.stopHoldRetry();
        return;
      }
      this.signalHoldRecovery();
    }, BACKEND_OUTAGE_HOLD_RETRY_MS);
  }

  /**
   * Дроп WS после живой связи = потеря бэка (7j.20). Первый дроп фиксирует начало (backdated). Повторный
   * дроп во время warning/settle = бэк снова упал (напр. crash-loop) → тот же инцидент возвращается в
   * error/progress (без нового fatal). Прочие повторы (WS-retry) игнорируем.
   */
  private onBackendDrop(): void {
    if (this.outageStart !== null) {
      if (this.outagePhase === 'warning') {
        if (this.outageSettleTimer !== undefined) {
          clearTimeout(this.outageSettleTimer);
          this.outageSettleTimer = undefined;
        }
        // Снова «после FATAL» — к OK только через новый warn; черновик recovering сбрасываем.
        this.outageNeedsWarnBeforeOk = true;
        this.pendingRecoveringDto = null;
        this.startOutageProgress(true);
      }
      return;
    }
    this.outageStart = Date.now();
    // §9.2/§9.3: одиночный 500 и бэк тут же упал → adopt requestId; иначе cold corr от дропа.
    const recentFatal =
      this.pendingFatalCorr !== null &&
      this.pendingFatalAt !== null &&
      Date.now() - this.pendingFatalAt < BACKEND_FATAL_ADOPT_WINDOW_MS;
    this.outageCorr = recentFatal ? this.pendingFatalCorr : `ohs.backend.outage:${this.outageStart}`;
    this.pendingFatalCorr = null;
    this.pendingFatalAt = null;
    this.outageNeedsWarnBeforeOk = true;
    this.setOutagePhase('grace');
    this.outageGraceTimer = setTimeout(() => {
      this.outageGraceTimer = undefined;
      if (this.outageStart === null || this.outageCorr === null) {
        return;
      }
      const corr = this.outageCorr;
      const start = this.outageStart!;
      const horizon = this.resolveOutageScheduleHorizon();
      this.outageScheduleDesired = horizon?.desired ?? null;
      // Лента Connection: сразу красный маркер + ползущая штриховка (API во время простоя молчит).
      this.link$.next({
        ...overlayCrashOutageOnLink(this.link$.value, start),
        linkRecoverGraceSeconds: this.link$.value.linkRecoverGraceSeconds,
        incidents: this.link$.value.incidents,
      });
      // 11.11: Incident в горизонте desired, иначе Group (не журнал инцидентов).
      const threadKindHint = horizon?.desired === false ? 'group' : 'incident';
      void import('./notifications').then((m) =>
        m.openBackendOutage(start, corr, threadKindHint, horizon?.connectionId),
      );
      this.startOutageProgress(false);
    }, BACKEND_OUTAGE_GRACE_MS);
  }

  /** Фаза error: живые тики длительности. immediate — тик сразу (возврат из warning / после 500). */
  private startOutageProgress(immediate: boolean): void {
    this.setOutagePhase('open');
    // §9.2: hold с open (ретраи) — иначе 500 до WS-reconnect уходит под requestId.
    this.ensureHoldRetry();
    this.signalHoldRecovery();
    if (this.outageTickTimer === undefined) {
      this.outageTickTimer = setInterval(() => {
        if (this.outageStart === null || this.outageCorr === null) {
          return;
        }
        // Горизонт crash = то же desired, что у break (кэш расписания).
        if (this.tryAbandonOutageBySchedule()) {
          return;
        }
        const corr = this.outageCorr;
        void import('./notifications').then((m) => m.tickBackendOutage(this.outageStart!, Date.now(), corr));
      }, BACKEND_OUTAGE_TICK_MS);
    }
    if (immediate && this.outageStart !== null && this.outageCorr !== null) {
      const corr = this.outageCorr;
      void import('./notifications').then((m) => m.tickBackendOutage(this.outageStart!, Date.now(), corr));
    }
  }

  /**
   * Бэк снова отвечает. Grace-блип — тихо сброс. Уже в warning — только обновить settle (без второго warn).
   * open → один WARNING recovering + settle (§9.2: пачка 500 даёт один вход сюда после кулдауна).
   */
  private onBackendReachable(): void {
    // Сначала сбросить отложенный schedule-end persist (инцидент уже закрыт локально).
    if (this.pendingOutagePersist !== null) {
      this.flushPendingOutagePersist();
      // После abandon лента могла остаться на клиентском клипе — подтянуть SoT.
      if (this.outageStart === null) {
        this.refreshLiveness();
      }
    }
    if (this.outageStart === null) {
      return;
    }
    if (this.outagePhase === 'grace') {
      this.clearOutageTimers();
      this.outageStart = null;
      this.setOutagePhase('none');
      this.outageCorr = null;
      this.outageNeedsWarnBeforeOk = false;
      this.pendingFatalCorr = null;
      this.pendingFatalAt = null;
      return;
    }

    if (this.outageTickTimer !== undefined) {
      clearInterval(this.outageTickTimer);
      this.outageTickTimer = undefined;
    }
    if (this.outageRecoverTimer !== undefined) {
      clearTimeout(this.outageRecoverTimer);
      this.outageRecoverTimer = undefined;
    }

    const corr = this.outageCorr ?? `ohs.backend.outage:${this.outageStart}`;
    this.signalHoldRecovery();

    // Уже recovering: повторный WS-reconnect не плодит второй warn — только перевзводим settle.
    if (this.outagePhase === 'warning') {
      this.armOutageSettle();
      return;
    }

    this.setOutagePhase('warning');
    this.outageNeedsWarnBeforeOk = false;
    void import('./notifications').then((m) => {
      // Live сразу; POST — в resolveOutage вместе с open+ok (иначе сирота recovering в БД).
      this.pendingRecoveringDto = m.warnBackendOutage(corr);
    });
    this.armOutageSettle();
  }

  /** Settle: readiness-проба → ждём стабильности → ok. Повторный дроп/500 гасит settle. */
  private armOutageSettle(): void {
    if (this.outageSettleTimer !== undefined) {
      clearTimeout(this.outageSettleTimer);
      this.outageSettleTimer = undefined;
    }
    const startSettle = (): void => {
      this.outageSettleTimer = setTimeout(() => {
        this.outageSettleTimer = undefined;
        if (this.outageStart === null || this.outagePhase !== 'warning') {
          return;
        }
        // Страховка инварианта: ok только после warn (не FATAL→OK).
        if (this.outageNeedsWarnBeforeOk) {
          this.onBackendReachable();
          return;
        }
        this.resolveOutage();
      }, BACKEND_OUTAGE_SETTLE_MS);
    };
    this.api.getConnections().subscribe({ next: startSettle, error: startSettle });
  }

  /**
   * После 500 (или пачки): кулдаун без нового 500 → один warn → settle → ok.
   * Каждый новый 500 сбрасывает таймер (§9.2 пример: fatal×3 → один warn).
   */
  private armOutageRecoveryAfterUnstable(): void {
    if (this.outageRecoverTimer !== undefined) {
      clearTimeout(this.outageRecoverTimer);
      this.outageRecoverTimer = undefined;
    }
    this.outageRecoverTimer = setTimeout(() => {
      this.outageRecoverTimer = undefined;
      if (this.outageStart === null || this.outagePhase !== 'open') {
        return;
      }
      this.onBackendReachable();
    }, BACKEND_OUTAGE_UNSTABLE_COOLDOWN_MS);
  }

  /**
   * WS-уведомления. `ohs.unhandled` (FATAL) во время инцидента (§9.2):
   *  • fold при чужом corr; гасим settle; error-тики; кулдаун — пачка 500 → один warn (не warn на каждый);
   *  • одиночный 500 без инцидента (§9.3) — health-probe;
   *  • в grace — публикуем, grace откроет инцидент.
   */
  private onServerNotification(dto: NotificationDto): void {
    const isBackendFatal = dto.code === 'ohs.unhandled' && (dto.severity ?? '') === 'critical';
    if (isBackendFatal) {
      const incidentShown = this.outagePhase === 'open' || this.outagePhase === 'warning';
      if (this.outageStart !== null && incidentShown && this.outageCorr !== null) {
        const outageCorr = this.outageCorr;
        const slipped = dto.correlationId !== outageCorr;
        void import('./notifications').then((m) => {
          if (slipped) {
            m.foldUnhandledIntoOutage(dto, outageCorr);
            this.api
              .postNotification({ ...dto, correlationId: outageCorr })
              .subscribe({ error: (err) => console.error('postNotification', err) });
          } else {
            m.publishServerNotification(dto);
          }
        });
        this.signalHoldRecovery();
        if (this.outageSettleTimer !== undefined) {
          clearTimeout(this.outageSettleTimer);
          this.outageSettleTimer = undefined;
        }
        // После FATAL снова нужен warn перед OK; кулдаун склеивает пачку в один warn.
        this.outageNeedsWarnBeforeOk = true;
        this.startOutageProgress(true);
        this.armOutageRecoveryAfterUnstable();
        return;
      }
      if (this.outageStart === null) {
        const corr = dto.correlationId ?? null;
        void import('./notifications').then((m) => m.publishServerNotification(dto));
        if (corr !== null) {
          this.pendingFatalCorr = corr;
          this.pendingFatalAt = Date.now();
          this.probeHealthAfterFatal(corr);
        }
        return;
      }
    }
    void import('./notifications').then((m) => m.publishServerNotification(dto));
  }

  /**
   * Одиночный 500 (§9.3): пробим health. Бэк ответил → закрываем «проверкой ОК» под ТЕМ ЖЕ corr (requestId)
   * и персистим её mock-POST'ом (сам 500 персистит бэк). Если к моменту ответа инцидент уже начался (бэк
   * упал, WS дропнул) — не трогаем: инцидент наследовал corr (adopt) и идёт своим чередом. Бэк не ответил —
   * эскалацию сделает onBackendDrop; pendingFatal живёт до окна adopt (нет дропа → останется одиночный FATAL).
   */
  private probeHealthAfterFatal(corr: string): void {
    this.api.getConnections().subscribe({
      next: () => {
        if (this.outageStart !== null || this.pendingFatalCorr !== corr) {
          return;
        }
        this.pendingFatalCorr = null;
        this.pendingFatalAt = null;
        void import('./notifications').then((m) => {
          const okDto = m.healthCheckOk(corr);
          this.api.postNotification(okDto).subscribe({ error: (err) => console.error('postNotification', err) });
        });
      },
      error: () => {
        // Бэк не ответил — вероятно упал; инцидент заведёт onBackendDrop (adopt corr).
      },
    });
  }

  /**
   * Connection с Auto + правилами из кэша (бэк может быть мёртв). Предпочитаем active, иначе первый Auto.
   */
  private resolveOutageScheduleHorizon(): {
    connectionId: number;
    label: string;
    desired: boolean;
  } | null {
    const schedules = this.connectionSchedule$.value;
    const connections = this.connections$.value;
    const activeId = this.activeConnectionId$.value;
    const candidates = connections.filter((c) => {
      const st = schedules.get(c.connectionId);
      return st?.settings.autoEnabled === true && st.rules.length > 0;
    });
    if (candidates.length === 0) {
      return null;
    }
    const row =
      (activeId != null ? candidates.find((c) => c.connectionId === activeId) : undefined) ??
      candidates[0];
    const st = schedules.get(row.connectionId)!;
    const desired = isConnectedNow(st.rules, new Date());
    const label = row.name?.trim()
      ? `Подключение ${row.connectionId} («${row.name}»)`
      : `Подключение ${row.connectionId}`;
    return { connectionId: row.connectionId, label, desired };
  }

  /**
   * Спад desired при открытом crash → WARNING schedule_end (локально) + очередь mock-POST.
   * Идемпотентно: только true→false.
   */
  private tryAbandonOutageBySchedule(): boolean {
    if (this.outageStart === null || this.outageCorr === null) {
      return false;
    }
    if (this.outagePhase !== 'open' && this.outagePhase !== 'warning') {
      return false;
    }
    const horizon = this.resolveOutageScheduleHorizon();
    if (horizon === null) {
      return false;
    }
    if (this.outageScheduleDesired === null) {
      this.outageScheduleDesired = horizon.desired;
      return false;
    }
    const wasDesired = this.outageScheduleDesired;
    this.outageScheduleDesired = horizon.desired;
    if (!(wasDesired && !horizon.desired)) {
      return false;
    }

    const start = this.outageStart;
    const corr = this.outageCorr;
    const end = Date.now();
    this.clearOutageTimers();
    this.outageStart = null;
    this.setOutagePhase('none');
    this.outageHeldSignaled = false;
    this.outageHoldInFlight = false;
    this.outageNeedsWarnBeforeOk = false;
    this.outageCorr = null;
    this.outageScheduleDesired = null;
    this.pendingRecoveringDto = null;
    // Клип штриховки на t_end (abandoned), без green — до refresh после оживления бэка.
    this.link$.next({
      intervals: this.link$.value.intervals,
      gaps: this.link$.value.gaps.map((g) =>
        g.to == null && g.cause === 'interrupted'
          ? { ...g, to: new Date(end).toISOString(), abandoned: true }
          : g,
      ),
      linkRecoverGraceSeconds: this.link$.value.linkRecoverGraceSeconds,
      incidents: this.link$.value.incidents,
    });

    void import('./notifications').then((m) => {
      const dtos = m.abandonBackendOutageBySchedule(
        start,
        end,
        corr,
        horizon.connectionId,
        horizon.label,
      );
      this.pendingOutagePersist = dtos;
      this.flushPendingOutagePersist();
    });
    return true;
  }

  /** mock-POST [open, incident_closed]; при мёртвом бэке оставит очередь до onBackendReachable. */
  private flushPendingOutagePersist(): void {
    const batch = this.pendingOutagePersist;
    if (batch === null || batch.length === 0) {
      return;
    }
    // Строго по порядку: иначе recovered раньше open → journal остаётся active.
    this.postNotificationsSequential(batch, () => {
      this.pendingOutagePersist = null;
      this.refreshLiveness();
    });
  }

  /** Последовательный mock-POST (open → … → close) — журнал и Hub видят один порядок. */
  private postNotificationsSequential(batch: NotificationDto[], onDone: () => void): void {
    const run = (i: number) => {
      if (i >= batch.length) {
        onDone();
        return;
      }
      this.api.postNotification(batch[i]).subscribe({
        next: () => run(i + 1),
        error: (err) => {
          console.error('postNotification', err);
          onDone();
        },
      });
    };
    run(0);
  }

  /** Закрытие: ok + mock-POST open+resolve. Вызывать только из warning после warn (§9.2). */
  private resolveOutage(): void {
    const start = this.outageStart;
    const corr = this.outageCorr;
    if (start === null || corr === null) {
      return;
    }
    // Последний рубеж: никогда FATAL→OK без recovering в стеке.
    if (this.outageNeedsWarnBeforeOk) {
      // Сбросить в open, иначе ветка «уже warning» не эмитит warn → цикл settle.
      this.setOutagePhase('open');
      this.onBackendReachable();
      return;
    }
    this.clearOutageTimers();
    this.outageStart = null;
    this.setOutagePhase('none');
    this.outageHeldSignaled = false;
    this.outageHoldInFlight = false;
    this.outageNeedsWarnBeforeOk = false;
    this.outageCorr = null;
    this.outageScheduleDesired = null;
    this.pendingOutagePersist = null;
    const recovering = this.pendingRecoveringDto;
    this.pendingRecoveringDto = null;
    const end = Date.now();
    void import('./notifications').then((m) => {
      const batch = m.resolveBackendOutage(start, end, corr, recovering);
      if (batch.length === 0) {
        this.refreshLiveness();
      } else {
        // open → recovering → recovered строго по порядку (журнал + NC).
        this.postNotificationsSequential(batch, () => this.refreshLiveness());
      }
      // После OK recover: спросить бэк про Auto×N stop + open break → Single INFO (не link-corr).
      this.api.getConnectionsNeedsOperator().subscribe({
        next: (rows) => {
          for (const row of rows) {
            const dto = m.publishOperatorActionNeeded(row);
            this.api.postNotification(dto).subscribe({
              error: (err) => console.error('postNotification', err),
            });
          }
        },
        error: (err) => console.error('getConnectionsNeedsOperator', err),
      });
    });
  }

  /** Переключает активный раздел верхнего уровня (левый рейл). */
  setActiveSection(section: NavSectionId): void {
    if (this.activeSection$.value !== section) {
      this.activeSection$.next(section);
    }
  }

  /** Выбирает таймфрейм (чипы D/W/M/Q/Y, All, диапазон) и пересчитывает окно. */
  setTimeframe(timeframe: Timeframe): void {
    this.timeframe$.next(timeframe);
    this.applyTimeframe(timeframe);
    this.persistView();
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

  /** Меняет тайм-лайн-фильтр (дни / полные сутки / окно сессии) и пере-проецирует ось. */
  setTimelineFilter(patch: Partial<TimelineFilter>): void {
    const next = this.normalizeTimeline({ ...this.timelineFilter$.value, ...patch });
    this.timelineFilter$.next(next);
    this.applyTimeframe(this.timeframe$.value);
    this.persistView();
  }

  /** Сброс тайм-лайн-фильтра в нейтраль (все дни + полные сутки, сессия не выбрана). */
  resetTimelineFilter(): void {
    this.timelineFilter$.next({ ...NEUTRAL_TIMELINE, weekdays: new Set(ALL_WEEKDAYS) });
    this.applyTimeframe(this.timeframe$.value);
    this.persistView();
  }

  /** Окно должно быть определено: без выбранной сессии показываем полные сутки. */
  private normalizeTimeline(f: TimelineFilter): TimelineFilter {
    return f.session.mode === 'none' && !f.fullDay ? { ...f, fullDay: true } : f;
  }

  /** Меняет стандарт времени отображения (единый на систему). */
  setDisplayTz(tz: DisplayTz): void {
    this.displayTz$.next(tz);
    this.persistView();
  }

  /** Переключает вертикальный time-line (crosshair) над Гантом (с сохранением). */
  setCrosshairOn(on: boolean): void {
    if (this.crosshairOn$.value !== on) {
      this.crosshairOn$.next(on);
      this.persistView();
    }
  }

  /** Переключает подсветку границ дней над Гантом (с сохранением). */
  setHighlightDays(on: boolean): void {
    if (this.highlightDays$.value !== on) {
      this.highlightDays$.next(on);
      this.persistView();
    }
  }

  /** Показывать / скрывать панель фильтров каталога (фильтры в сторе не сбрасываются). */
  setShowFilters(on: boolean): void {
    if (this.showFilters$.value !== on) {
      this.showFilters$.next(on);
      this.persistView();
    }
  }

  /** Нужно ли генерировать выходные (для счётчика сессий) — по набору дней недели. */
  private genIncludeWeekends(): boolean {
    const w = this.timelineFilter$.value.weekdays;
    return w.has(0) || w.has(6);
  }

  /** Биржа для режима `smart`: одна выбранная → она; микс → null (=полные сутки); ничего → домашняя. */
  private pickSmartExchange(): string | null {
    const ex = this.instrumentQuery$.value.exchanges;
    if (ex && ex.length === 1) {
      return ex[0];
    }
    if (ex && ex.length > 1) {
      return null;
    }
    return HOME_EXCHANGE;
  }

  /** Разворачивает `smart` в конкретное окно сессии (сессия выбранной биржи или «не выбрана»). */
  private resolveSession(mode: SessionWindowMode): SessionWindowMode {
    if (mode.mode !== 'smart') {
      return mode;
    }
    const ex = this.pickSmartExchange();
    return ex ? { mode: 'session', exchange: ex } : { mode: 'none' };
  }

  /** Фильтрует дни по набору дней недели и переразмечает окно дня. */
  private shapeSessions(sessions: SessionDto[]): SessionDto[] {
    const { weekdays, fullDay, session } = this.timelineFilter$.value;
    const resolved = this.resolveSession(session);
    const out: SessionDto[] = [];
    for (const s of sessions) {
      if (weekdays.has(weekdayOfIso(s.date))) {
        out.push(reshapeDay(s, fullDay, resolved));
      }
    }
    return out;
  }

  /** Применяет тайм-лайн-фильтр к набору сессий и выставляет sessions$/window$. */
  private publishSessions(ordered: SessionDto[]): void {
    const shaped = this.shapeSessions(ordered);
    this.sessions$.next(shaped);
    if (shaped.length === 0) {
      const t = todaySession();
      this.setWindow({ from: new Date(t.startMs).toISOString(), to: new Date(t.endMs).toISOString() });
      return;
    }
    this.setWindow({ from: shaped[0].start, to: shaped[shaped.length - 1].end });
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
    // Выходные для генерации берём из тайм-лайн-фильтра (набор дней недели), а не из tf.
    const iw = this.genIncludeWeekends();

    // Календарные единицы (M/Q/Y) — сдвиг назад на n месяцев/кварталов/лет, но ось тоже
    // посессионная: каждый торговый день — доля, ночь/разрывы схлопнуты (как D/W, только длиннее).
    if (tf.unit === 'M' || tf.unit === 'Q' || tf.unit === 'Y') {
      const fromDate = shiftMonths(mskDateOf(), monthsPerUnit(tf.unit) * tf.count);
      const fromMs = sessionBounds(fromDate).startMs;
      this.publishSessions(sessionsFrom(fromMs, iw));
      return;
    }

    // D/W: календарный скелет локально (включая пустые выходные), часы — ISS с бэка.
    const count = sessionCount(tf.unit, tf.count, iw);
    const calendar = recentSessions(count, iw);
    this.api.getSessions(count, iw, HOME_ENGINE).subscribe({
      next: (api) => this.publishSessions(mergeSessionHours(calendar, api)),
      error: (err) => {
        console.error('getSessions', err);
        this.publishSessions(calendar);
      },
    });
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
    this.publishSessions(sessionsFrom(loMs, this.genIncludeWeekends(), hiMs));
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
    persistSelectedInstruments(next);

    if (this.instrumentQuery$.value.instrumentIds !== undefined) {
      this.setInstrumentFilter({ instrumentIds: [...next] });
    }
  }

  /** Выделяет/снимает всю опционную серию; состав серии при необходимости загружается лениво. */
  toggleSeriesSelection(futuresId: number, expiration: string): void {
    this.ensureStrikes(futuresId, expiration).subscribe({
      next: (strikes) => {
        if (strikes.length === 0) {
          return;
        }
        const next = new Set(this.selectedInstruments$.value);
        const allSelected = strikes.every((option) => next.has(option.instrumentId));
        for (const option of strikes) {
          if (allSelected) {
            next.delete(option.instrumentId);
          } else {
            next.add(option.instrumentId);
          }
        }
        this.selectedInstruments$.next(next);
        persistSelectedInstruments(next);

        if (this.instrumentQuery$.value.instrumentIds !== undefined) {
          this.setInstrumentFilter({ instrumentIds: [...next] });
        }
      },
      error: (err) => console.error('toggleSeriesSelection', err),
    });
  }

  /** Добавляет плашку-фильтр (если ещё не добавлена). Значения выбираются в поповере. */
  addFilter(key: FilterKey): void {
    if (this.activeFilters$.value.includes(key)) {
      return;
    }
    this.activeFilters$.next([...this.activeFilters$.value, key]);
    this.persistView();
  }

  /** Убирает плашку и очищает относящиеся к ней поля запроса. */
  removeFilter(key: FilterKey): void {
    this.activeFilters$.next(this.activeFilters$.value.filter((k) => k !== key));
    this.setInstrumentFilter(this.clearedFieldsFor(key));
  }

  /** Сбрасывает все плашки и фильтр-поля запроса (поиск не трогаем). */
  clearFilters(): void {
    this.activeFilters$.next([]);
    this.selectionScope$.next(DEFAULT_SELECTION_SCOPE);
    this.setInstrumentFilter({
      category: undefined,
      onlyRecording: undefined,
      nonEmpty: undefined,
      instrumentIds: undefined,
      includeOptionAncestors: undefined,
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
      includeOptionAncestors: this.selectionScope$.value !== 'base',
    });
  }

  /** Область применения «Выбор»: ко всем инструментам или только к БА. */
  setSelectionScope(scope: SelectionScope): void {
    if (this.selectionScope$.value === scope) {
      return;
    }
    this.selectionScope$.next(scope);
    this.setInstrumentFilter({ includeOptionAncestors: scope !== 'base' });
  }

  /** Патч query-полей для очистки при снятии плашки. */
  private clearedFieldsFor(key: FilterKey): Partial<InstrumentQueryParams> {
    switch (key) {
      case 'instruments':
        return { category: undefined };
      case 'selection':
        return {
          onlyRecording: undefined,
          nonEmpty: undefined,
          instrumentIds: undefined,
          includeOptionAncestors: undefined,
        };
      case 'exchanges':
        return { exchanges: undefined };
    }
  }

  /** Меняет фильтр каталога (сбрасывает offset + дерево) и перезагружает первую страницу. */
  setInstrumentFilter(patch: Partial<InstrumentQueryParams>): void {
    this.instrumentQuery$.next({ ...this.instrumentQuery$.value, ...patch, offset: 0 });
    this.collapseTree();
    this.fetchInstruments(false);
    this.persistView();
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
    this.persistView();
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
    this.persistView();
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
    this.ensureStrikes(futuresId, expiration).subscribe({
      error: (err) => console.error('loadStrikes', err),
    });
  }

  /** Возвращает страйки серии из кэша либо подтягивает их (и кладёт в кэш). */
  private ensureStrikes(futuresId: number, expiration: string): Observable<InstrumentDto[]> {
    const key = seriesKey(futuresId, expiration);
    const cached = this.strikesBySeries$.value.get(key);
    if (cached) {
      return of(cached);
    }
    return this.api
      .getInstruments({ underlyingId: futuresId, expiration, secType: 'OPT', limit: SERIES_STRIKES_LIMIT, offset: 0 })
      .pipe(
        map((page) => page.items),
        tap((items) => {
          const next = new Map(this.strikesBySeries$.value);
          next.set(key, items);
          this.strikesBySeries$.next(next);
        }),
      );
  }

  private setSeriesBusy(key: string, busy: boolean): void {
    const next = new Set(this.seriesBusy$.value);
    if (busy) {
      next.add(key);
    } else {
      next.delete(key);
    }
    this.seriesBusy$.next(next);
  }

  /**
   * Ставит на запись всю опционную серию: подтягивает страйки (если ещё не загружены)
   * и стартует запись по каждому торгуемому, ещё не записываемому инструменту
   * (ограниченная параллельность). Ошибки по отдельным страйкам не прерывают пакет.
   */
  startSeries(futuresId: number, expiration: string, connectionId: number): void {
    const key = seriesKey(futuresId, expiration);
    if (this.seriesBusy$.value.has(key)) {
      return;
    }
    this.setSeriesBusy(key, true);
    this.ensureStrikes(futuresId, expiration)
      .pipe(
        switchMap((strikes) => {
          const recording = new Set(this.recordings$.value.map((r) => r.instrumentId));
          const targets = strikes.filter((o) => o.active && !recording.has(o.instrumentId));
          if (targets.length === 0) {
            return of<unknown[]>([]);
          }
          return from(targets).pipe(
            mergeMap(
              (o) =>
                this.api.startRecording({ instrumentId: o.instrumentId, connectionId }).pipe(
                  catchError((err) => {
                    console.error('startSeries item', o.instrumentId, err);
                    return of(null);
                  }),
                ),
              SERIES_CONCURRENCY,
            ),
            toArray(),
          );
        }),
        finalize(() => {
          this.setSeriesBusy(key, false);
          this.refreshRecordings();
          this.refreshCoverage();
        }),
      )
      .subscribe({ error: (err) => console.error('startSeries', err) });
  }

  /**
   * Останавливает запись всей серии: гасит запись по всем страйкам серии,
   * которые сейчас пишутся, и снимает Auto со всех членов серии.
   */
  stopSeries(futuresId: number, expiration: string): void {
    const key = seriesKey(futuresId, expiration);
    if (this.seriesBusy$.value.has(key)) {
      return;
    }
    this.setSeriesBusy(key, true);
    this.ensureStrikes(futuresId, expiration)
      .pipe(
        switchMap((strikes) => {
          const members = strikes.map((o) => o.instrumentId);
          const memberSet = new Set(members);
          const targets = this.recordings$.value
            .filter((r) => memberSet.has(r.instrumentId))
            .map((r) => r.instrumentId);
          const stop$ =
            targets.length === 0
              ? of<unknown[]>([])
              : from(targets).pipe(
                  mergeMap(
                    (id) =>
                      this.api.stopRecording(id).pipe(
                        catchError((err) => {
                          console.error('stopSeries item', id, err);
                          return of(null);
                        }),
                      ),
                    SERIES_CONCURRENCY,
                  ),
                  toArray(),
                );
          return stop$.pipe(
            switchMap(() => this.disableAutoMany$(members)),
          );
        }),
        finalize(() => {
          this.setSeriesBusy(key, false);
          this.refreshRecordings();
          this.refreshCoverage();
          this.refreshRecordingSchedule();
        }),
      )
      .subscribe({ error: (err) => console.error('stopSeries', err) });
  }

  /** Включает/выключает Auto для одного инструмента. */
  setRecordingAuto(instrumentId: number, connectionId: number, autoEnabled: boolean): void {
    this.api
      .upsertRecordingSchedule({ items: [{ instrumentId, connectionId, autoEnabled }] })
      .subscribe({
        next: (rows) => this.mergeSchedule(rows),
        error: (err) => console.error('setRecordingAuto', err),
      });
  }

  /**
   * Auto серии: включает/выключает Auto на всех активных страйках
   * (аналог Старт серии по охвату).
   */
  setSeriesAuto(futuresId: number, expiration: string, connectionId: number, autoEnabled: boolean): void {
    const key = seriesKey(futuresId, expiration);
    if (this.seriesBusy$.value.has(key)) {
      return;
    }
    this.setSeriesBusy(key, true);
    this.ensureStrikes(futuresId, expiration)
      .pipe(
        switchMap((strikes) => {
          const targets = autoEnabled ? strikes.filter((o) => o.active) : strikes;
          if (targets.length === 0) {
            return of<RecordingScheduleDto[]>([]);
          }
          return this.api.upsertRecordingSchedule({
            items: targets.map((o) => ({
              instrumentId: o.instrumentId,
              connectionId,
              autoEnabled,
            })),
          });
        }),
        finalize(() => this.setSeriesBusy(key, false)),
      )
      .subscribe({
        next: (rows) => this.mergeSchedule(rows),
        error: (err) => console.error('setSeriesAuto', err),
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
        if (!append) {
          this.expandSelectedSpine();
        }
      },
      error: (err) => {
        console.error('getInstruments', err);
        this.instrumentsLoading$.next(false);
      },
    });
  }

  /**
   * Scope «ко всем»: резолвит совпавшие OPT → (underlying, expiration), авто-раскрывает
   * spine future → series → option. Scope «только к БА» / нет условий — очищает spine.
   */
  private expandSelectedSpine(): void {
    const q = this.instrumentQuery$.value;
    const hasSelection =
      Boolean(q.onlyRecording) || Boolean(q.nonEmpty) || q.instrumentIds !== undefined;
    if (!hasSelection || this.selectionScope$.value === 'base') {
      this.selectedOptionSpine$.next(new Map());
      this.selectionLeafIds$.next(new Set());
      return;
    }
    // «Выделенные» без id — пустой результат, не тянем все опционы категории.
    if (q.instrumentIds !== undefined && q.instrumentIds.length === 0 && !q.onlyRecording && !q.nonEmpty) {
      this.selectedOptionSpine$.next(new Map());
      this.selectionLeafIds$.next(new Set());
      return;
    }

    this.api
      .getInstruments({
        category: 'options',
        onlyRecording: q.onlyRecording,
        nonEmpty: q.nonEmpty,
        instrumentIds: q.instrumentIds?.length ? [...q.instrumentIds] : undefined,
        includeOptionAncestors: false,
        limit: 500,
        offset: 0,
      })
      .subscribe({
        next: (page) => {
          const spine = new Map<number, Set<string>>();
          const leaves = new Set<number>();
          for (const opt of page.items) {
            leaves.add(opt.instrumentId);
            const underlyingId = opt.underlyingId;
            const expiration = opt.expiration;
            if (underlyingId == null || !expiration) {
              continue;
            }
            let exps = spine.get(underlyingId);
            if (!exps) {
              exps = new Set();
              spine.set(underlyingId, exps);
            }
            exps.add(expiration);
          }
          this.selectedOptionSpine$.next(spine);
          this.selectionLeafIds$.next(leaves);
          if (spine.size === 0) {
            return;
          }

          const futures = new Set(this.expandedFutures$.value);
          const series = new Set(this.expandedSeries$.value);
          for (const [futuresId, exps] of spine) {
            futures.add(futuresId);
            if (!this.seriesByFutures$.value.has(futuresId)) {
              this.loadSeries(futuresId);
            }
            for (const expiration of exps) {
              const key = seriesKey(futuresId, expiration);
              series.add(key);
              if (!this.strikesBySeries$.value.has(key)) {
                this.loadStrikes(futuresId, expiration);
              }
            }
          }
          this.expandedFutures$.next(futures);
          this.expandedSeries$.next(series);
          this.persistView();
        },
        error: (err) => console.error('expandSelectedSpine', err),
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
      next: (x) => {
        this.connections$.next(x);
        for (const c of x) {
          this.refreshConnectionSchedule(c.connectionId);
        }
      },
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

  /**
   * Задаёт, для каких инструментов и по какому источнику показывать слой сделок (обычно —
   * видимые строки провайдера + его `sourceId`). Пере-запрашивает активность при изменении.
   */
  setActivityContext(instrumentIds: readonly number[], sourceId: number): void {
    const prev = this.activityContext;
    const changed =
      prev === null ||
      prev.sourceId !== sourceId ||
      prev.instrumentIds.length !== instrumentIds.length ||
      instrumentIds.some((id, i) => prev.instrumentIds[i] !== id);
    this.activityContext = { instrumentIds: [...instrumentIds], sourceId };
    if (changed) {
      this.refreshActivity();
    }
    this.setLivenessSource(sourceId);
  }

  /** Задаёт источник для живости захвата (обычно `connection.sourceId` провайдера). */
  setLivenessSource(sourceId: number): void {
    if (this.livenessSourceId !== sourceId) {
      this.livenessSourceId = sourceId;
      this.refreshLiveness();
    }
  }

  /** Догружает интервалы живости и журнал разрывов для текущего окна и источника. */
  refreshLiveness(): void {
    const sourceId = this.livenessSourceId;
    if (sourceId === null) {
      this.liveness$.next({ intervals: [], gaps: [] });
      this.link$.next({
        intervals: [],
        gaps: [],
        linkRecoverGraceSeconds: undefined,
        incidents: undefined,
      });
      return;
    }
    const { from, to } = this.window$.value;
    const connectionId = this.activeConnectionId$.value;
    this.api.getCaptureLiveness({ from, to, sourceId }).subscribe({
      next: (dto) => {
        const gaps =
          dto.intervals.length > 0 ? gapsFromLivenessIntervals(dto.intervals) : dto.gaps;
        this.liveness$.next({ intervals: dto.intervals, gaps });
      },
      error: (err) => console.error('getCaptureLiveness', err),
    });
    // Лента Connection (phase 7h.8): вся история связи по тому же источнику. Gaps берём с сервера как
    // есть — они включают серый 'disconnected' (в отличие от захвата, где серое отфильтровано).
    this.api.getLinkLiveness({ from, to, sourceId }).subscribe({
      next: (dto) => {
        // Во время открытого crash не затираем оптимистичную штриховку ответом «до дропа».
        const grace = dto.linkRecoverGraceSeconds;
        const prevIncidents = this.link$.value.incidents;
        if (this.outagePhase === 'open' || this.outagePhase === 'warning') {
          if (this.outageStart !== null) {
            this.link$.next({
              ...overlayCrashOutageOnLink(dto, this.outageStart),
              linkRecoverGraceSeconds: grace,
              incidents: prevIncidents,
            });
            return;
          }
        }
        this.link$.next({
          intervals: dto.intervals,
          gaps: dto.gaps,
          linkRecoverGraceSeconds: grace,
          incidents: prevIncidents,
        });
      },
      error: (err) => console.error('getLinkLiveness', err),
    });
    // 11.13e: цветные эпизоды Connection + бинарный red Recording ← журнал incident.
    if (connectionId != null) {
      this.api.getConnectionIncidents(connectionId, { from, to, limit: 500 }).subscribe({
        next: (incidents) => {
          this.link$.next({ ...this.link$.value, incidents });
        },
        error: (err) => {
          console.error('getConnectionIncidents', err);
          this.link$.next({ ...this.link$.value, incidents: [] });
        },
      });
    } else {
      this.link$.next({ ...this.link$.value, incidents: undefined });
    }
  }

  /** Догружает слой сделок для текущего контекста, окна и бакета таймфрейма (батч-запрос). */
  refreshActivity(): void {
    const ctx = this.activityContext;
    const bucketSeconds = bucketSecondsForTimeframe(this.timeframe$.value);
    if (ctx === null || ctx.instrumentIds.length === 0) {
      this.activity$.next({ bucketMs: bucketSeconds * 1000, byInstrument: new Map() });
      return;
    }
    const { from, to } = this.window$.value;
    this.api
      .getTradeActivity({
        from,
        to,
        bucketSeconds,
        sourceId: ctx.sourceId,
        instrumentIds: [...ctx.instrumentIds],
      })
      .subscribe({
        next: (rows) => {
          const byInstrument = new Map<number, number[]>();
          for (const r of rows) {
            byInstrument.set(
              r.instrumentId,
              r.buckets.map((b) => Date.parse(b)),
            );
          }
          this.activity$.next({ bucketMs: bucketSeconds * 1000, byInstrument });
        },
        error: (err) => console.error('getTradeActivity', err),
      });
  }

  setWindow(window: CoverageWindow): void {
    this.window$.next(window);
    this.refreshCoverage();
    this.refreshActivity();
    this.refreshLiveness();
  }

  connect(connectionId: number): void {
    // Оптимистичный промежуточный статус: connect на бэке синхронный, но пока
    // POST в полёте — показываем «подключается» (жёлтый), затем connected/error.
    this.patchConnectionStatus(connectionId, 'connecting');
    this.api
      .connect(connectionId)
      .pipe(
        timeout(35_000),
        catchError((err: { response?: { error?: string }; message?: string }) => {
          const detail = err?.response?.error ?? err?.message ?? 'неизвестная ошибка';
          console.error('connect', detail, err);
          this.patchConnectionStatus(connectionId, 'error');
          return EMPTY;
        }),
        finalize(() => {
          const row = this.connections$.value.find((c) => c.connectionId === connectionId);
          if (row?.status === 'connecting') {
            this.refreshConnections();
          }
        }),
      )
      .subscribe({
        next: (c) => {
          if (c.status === 'disconnected') {
            // Бэк не смог поднять сессию (осиротевший коннектор / обрыв сразу после connect).
            this.patchConnectionStatus(c.connectionId, 'error');
            return;
          }
          this.upsertConnection(c);
        },
      });
  }

  /** Сброс зависшего «подключается…» (тумблер снова кликабелен). */
  cancelConnect(): void {
    this.refreshConnections();
  }

  disconnect(connectionId: number): void {
    this.api.disconnect(connectionId).subscribe({
      next: (c) => {
        this.upsertConnection(c);
        // Бэкенд снимает Auto; подтягиваем актуальное schedule.
        this.refreshConnectionSchedule(connectionId);
      },
      error: (err) => console.error('disconnect', err),
    });
  }

  /** Auto on/off для соединения (настройки уровня соединения). */
  setConnectionAuto(connectionId: number, autoEnabled: boolean): void {
    this.api.putConnectionScheduleSettings(connectionId, { autoEnabled }).subscribe({
      next: () => this.refreshConnectionSchedule(connectionId),
      error: (err) => console.error('setConnectionAuto', err),
    });
  }

  /**
   * Атомарная пачка schedule-операций (Saga, всё-или-ничего): один POST …/schedule/batch.
   * Сервер применяет всё в одной транзакции и публикует сводку в NC. Клиент только сверяет
   * истину (refresh) и решает судьбу попапа через {@link handlers}: `onSuccess` — закрыть,
   * `onError` — оставить открытым с баннером. При обрыве сети (`status 0`) сервер опубликовать
   * не мог — публикуем клиентский NC (кейс 1e).
   */
  applyConnectionScheduleBatch(
    connectionId: number,
    args: {
      upserts: PutConnectionScheduleRuleRequest[];
      cancels: number[];
      composeKind: 'cleared' | 'applied' | 'recreated';
      items: ScheduleComposeItemDto[];
    },
    handlers?: {
      onSuccess?: () => void;
      onError?: (info: { kind: 'server' | 'network'; message?: string }) => void;
    },
  ): void {
    const batchId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `sched-${connectionId}-${Date.now()}`;
    this.api
      .applyScheduleBatch(connectionId, {
        batchId,
        kind: args.composeKind,
        upserts: args.upserts,
        cancels: args.cancels,
        items: args.items,
      })
      .subscribe({
        next: () => {
          this.refreshConnectionSchedule(connectionId);
          handlers?.onSuccess?.();
        },
        error: (err) => {
          // Атомарная транзакция → частичной записи не бывает; всё равно сверяем истину.
          this.refreshConnectionSchedule(connectionId);
          const status = (err as { status?: number })?.status ?? 0;
          if (status === 0) {
            // 1e: запрос не дошёл/таймаут — сервер не опубликовал, публикуем сами (user·error).
            const name =
              this.connections$.value.find((c) => c.connectionId === connectionId)?.name ??
              String(connectionId);
            notify.error(notificationBus, {
              module: 'ohs.connection',
              code: 'connection.schedule.batch_failed',
              sourceType: 'user',
              correlationId: batchId,
              message: `Расписание ${connectionId} («${name}»): нет связи с сервером`,
              data: {
                connectionId,
                batchId,
                lines: [
                  'Изменения не подтверждены — проверьте состояние после переподключения',
                  'Повторите попытку',
                ],
              },
            });
            handlers?.onError?.({ kind: 'network' });
          } else {
            // 4xx/5xx: NC уже опубликовал сервер — попапу оставить баннер.
            const message = (err as { response?: { error?: string } })?.response?.error;
            handlers?.onError?.({ kind: 'server', message });
          }
        },
      });
  }

  refreshConnectionSchedule(connectionId: number): void {
    this.api.getConnectionSchedule(connectionId).subscribe({
      next: (state) => this.upsertConnectionSchedule(state),
      error: (err) => console.error('refreshConnectionSchedule', err),
    });
  }

  private upsertConnectionSchedule(state: ConnectionScheduleStateDto): void {
    const next = new Map(this.connectionSchedule$.value);
    next.set(state.settings.connectionId, state);
    this.connectionSchedule$.next(next);
  }

  /**
   * Создаёт подключение с обязательной проверкой: validate (без записи) →
   * upsert → setCredentials. Если проверка не прошла — в БД ничего не создаётся,
   * вызывается `onError(message)`. При успехе — `onSuccess(connection)`.
   */
  createConnection(
    request: UpsertConnectionRequest,
    credentials: { login: string; password: string } | null,
    callbacks: { onSuccess: (c: ConnectionDto) => void; onError: (message: string) => void },
  ): void {
    const creds = credentials && credentials.login.trim() ? credentials : null;
    this.api
      .validateConnection({
        kind: request.kind,
        settings: request.settings,
        login: creds?.login,
        password: creds?.password,
      })
      .pipe(
        switchMap((res) =>
          res.ok
            ? this.api.upsertConnection(request)
            : throwError(() => new Error(res.message ?? 'Проверка подключения не пройдена')),
        ),
        switchMap((connection) =>
          creds
            ? this.api.setCredentials(connection.connectionId, creds).pipe(map(() => connection))
            : of(connection),
        ),
      )
      .subscribe({
        next: (connection) => {
          this.upsertConnection(connection);
          callbacks.onSuccess(connection);
        },
        error: (err) => callbacks.onError(err instanceof Error ? err.message : String(err)),
      });
  }

  /**
   * Обновляет подключение по id. Если переданы креды — сначала проверка (validate),
   * затем PUT и сохранение кред; без кред проверка пропускается (креды не меняются).
   */
  updateConnection(
    connectionId: number,
    request: UpsertConnectionRequest,
    credentials: { login: string; password: string } | null,
    callbacks: { onSuccess: (c: ConnectionDto) => void; onError: (message: string) => void },
  ): void {
    const creds = credentials && credentials.login.trim() ? credentials : null;
    const validate$ = creds
      ? this.api.validateConnection({
          kind: request.kind,
          settings: request.settings,
          login: creds.login,
          password: creds.password,
        })
      : of<ValidateConnectionResult>({ ok: true });

    validate$
      .pipe(
        switchMap((res) =>
          res.ok
            ? this.api.updateConnection(connectionId, request)
            : throwError(() => new Error(res.message ?? 'Проверка подключения не пройдена')),
        ),
        switchMap((connection) =>
          creds
            ? this.api.setCredentials(connection.connectionId, creds).pipe(map(() => connection))
            : of(connection),
        ),
      )
      .subscribe({
        next: (connection) => {
          this.upsertConnection(connection);
          callbacks.onSuccess(connection);
        },
        error: (err) => callbacks.onError(err instanceof Error ? err.message : String(err)),
      });
  }

  /** Удаляет подключение; при успехе убирает его из списка и вызывает `onDone`. */
  deleteConnection(connectionId: number, onDone?: () => void): void {
    this.api.deleteConnection(connectionId).subscribe({
      next: () => {
        this.connections$.next(
          this.connections$.value.filter((c) => c.connectionId !== connectionId),
        );
        onDone?.();
      },
      error: (err) => console.error('deleteConnection', err),
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

  /**
   * Ручной стоп: гасит запись и Auto у инструмента; у соседей серии (если переданы)
   * снимает только Auto.
   */
  stopRecording(instrumentId: number, seriesSiblingIds: number[] = []): void {
    const siblings = seriesSiblingIds.filter((id) => id !== instrumentId);
    this.api.stopRecording(instrumentId).subscribe({
      next: () => {
        this.refreshRecordings();
        this.refreshCoverage();
        if (siblings.length > 0) {
          this.disableAutoMany$(siblings).subscribe({
            next: () => this.refreshRecordingSchedule(),
            error: (err) => console.error('stopRecording clear series auto', err),
          });
        } else {
          this.refreshRecordingSchedule();
        }
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

      case 'connectionStateChanged': {
        const status = linkStateToConnectionStatus(event.state);
        this.connections$.next(
          this.connections$.value.map((c) =>
            c.connectionId === event.connectionId ? { ...c, status } : c,
          ),
        );
        this.refreshLiveness();
        if (status === 'disconnected' || status === 'error') {
          this.refreshCoverage();
        }
        break;
      }

      case 'coverageExtended':
        this.applyCoverageExtended(event.instrumentId, event.sourceId, event.tradeCount, event.to);
        break;

      case 'recordingStarted':
        this.refreshRecordings();
        this.refreshCoverage();
        break;

      case 'recordingStopped':
        this.refreshRecordings();
        this.refreshCoverage();
        break;

      case 'recordingScheduleChanged':
        this.replaceSchedule(event.items);
        break;

      case 'notification':
        this.onServerNotification(event.notification);
        break;
    }
  }

  private refreshRecordingSchedule(): void {
    this.api.getRecordingSchedule().subscribe({
      next: (rows) => this.replaceSchedule(rows),
      error: (err) => console.error('getRecordingSchedule', err),
    });
  }

  /** Подтягивает бэклог уведомлений (GET /api/notifications) в шину дока при старте (крит. #2). */
  private refreshNotifications(): void {
    this.api.getNotifications().subscribe({
      next: (rows) => {
        void import('./notifications').then((m) => m.hydrateServerBacklog(rows));
      },
      error: (err) => console.error('getNotifications', err),
    });
  }

  private replaceSchedule(rows: RecordingScheduleDto[]): void {
    const byId = new Map<number, RecordingScheduleDto>();
    for (const row of rows) {
      byId.set(row.instrumentId, row);
    }
    this.recordingSchedule$.next(byId);
  }

  private mergeSchedule(rows: RecordingScheduleDto[]): void {
    const next = new Map(this.recordingSchedule$.value);
    for (const row of rows) {
      if (row.autoEnabled) {
        next.set(row.instrumentId, row);
      } else {
        next.delete(row.instrumentId);
      }
    }
    this.recordingSchedule$.next(next);
  }

  private disableAutoMany$(instrumentIds: number[]): Observable<RecordingScheduleDto[]> {
    const items = instrumentIds
      .map((instrumentId) => {
        const existing = this.recordingSchedule$.value.get(instrumentId);
        if (!existing?.autoEnabled) {
          return null;
        }
        return {
          instrumentId,
          connectionId: existing.connectionId,
          autoEnabled: false,
        };
      })
      .filter((x): x is RecordingScheduleDto => x != null);
    if (items.length === 0) {
      return of([]);
    }
    return this.api.upsertRecordingSchedule({ items }).pipe(
      tap((rows) => this.mergeSchedule(rows)),
    );
  }

  private applyCoverageExtended(
    instrumentId: number,
    sourceId: number,
    tradeCount: number,
    lastTradeTs: string,
  ): void {
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

    // Живой край слоя сделок: бакет последней сделки добавляем локально (без перезапроса).
    this.appendActivityBucket(instrumentId, sourceId, lastTradeTs);

    // Если активного сегмента ещё нет в окне — подтягиваем coverage.
    const hasActive = this.coverage$.value.some(
      (s) => s.instrumentId === instrumentId && s.sourceId === sourceId && s.to === null,
    );
    if (!hasActive) {
      this.refreshCoverage();
    }
  }

  /**
   * Живой апдейт слоя сделок: добавляет бакет последней сделки в activity$ (append-only, без
   * полного перезапроса). Выравнивание бакета — floor к эпохе (совпадает с `time_bucket` бэкенда).
   */
  private appendActivityBucket(instrumentId: number, sourceId: number, lastTradeTs: string): void {
    if (this.activityContext?.sourceId !== sourceId) {
      return;
    }
    const state = this.activity$.value;
    const existing = state.byInstrument.get(instrumentId);
    if (existing === undefined) {
      return;
    }
    const lastMs = Date.parse(lastTradeTs);
    if (Number.isNaN(lastMs)) {
      return;
    }
    const bucketStart = Math.floor(lastMs / state.bucketMs) * state.bucketMs;
    if (existing.length > 0 && existing[existing.length - 1] >= bucketStart) {
      return;
    }
    const byInstrument = new Map(state.byInstrument);
    byInstrument.set(instrumentId, [...existing, bucketStart]);
    this.activity$.next({ ...state, byInstrument });
  }

  /** Локально меняет только статус подключения (оптимистичные переходы UI). */
  private patchConnectionStatus(connectionId: number, status: string): void {
    this.connections$.next(
      this.connections$.value.map((c) =>
        c.connectionId === connectionId ? { ...c, status } : c,
      ),
    );
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
