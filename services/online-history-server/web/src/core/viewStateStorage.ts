import type {
  DisplayTz,
  FilterKey,
  SelectionScope,
  SessionWindowMode,
  Timeframe,
  TimeframeUnit,
} from './types';

const STORAGE_KEY = 'ohs:viewState';

/** Раскрытая серия деривативов (для регидрации дерева после перезагрузки). */
export interface PersistedSeries {
  futuresId: number;
  expiration: string;
}

/** Тайм-лайн-фильтр в сериализуемой форме (Set дней → массив). */
export interface PersistedTimeline {
  weekdays: number[];
  fullDay: boolean;
  session: SessionWindowMode;
}

/**
 * Представление каталога, переживающее переход между разделами и перезагрузку страницы:
 * активный провайдер, применённые плашки-фильтры и раскрытые узлы дерева. Выделенные инструменты
 * хранятся отдельно (см. selectedInstrumentsStorage) — здесь только флаг активности их фильтра.
 */
export interface PersistedViewState {
  activeConnectionId: number | null;
  activeFilters: FilterKey[];
  category?: string;
  onlyRecording?: boolean;
  nonEmpty?: boolean;
  /** Активно ли условие «Выделенные» (сам список id — в selectedInstrumentsStorage). */
  selected?: boolean;
  /** Область «Выбор»: ко всем / только к БА. */
  selectionScope?: SelectionScope;
  exchanges?: string[];
  expandedFutures: number[];
  expandedSeries: PersistedSeries[];
  /** Горизонт Ганта (D1/W2/M/… / All / диапазон). */
  timeframe?: Timeframe;
  /** D+: якорь горизонта — завтра (сессия может забегать за полночь). */
  dPlus?: boolean;
  /** Нижний тайм-лайн-фильтр оси: дни недели + окно дня/сессии. */
  timeline?: PersistedTimeline;
  /** Стандарт времени отображения (ось/тултипы). */
  displayTz?: DisplayTz;
  /** Тумблер вертикального time-line (crosshair) над Гантом. */
  crosshair?: boolean;
  /** Тумблер подсветки границ дней над Гантом. */
  highlightDays?: boolean;
  /** Показывать панель фильтров каталога (шестерёнка провайдера). */
  showFilters?: boolean;
  /** Показывать now-маркер (вертикаль «сейчас») на лентах Connection/Recording. */
  showNowMarker?: boolean;
  /** Слой голубого/серого из `link_liveness` на Connection. */
  showLinkRibbon?: boolean;
  /** Линейка времени под лентой Connection. */
  showRuler?: boolean;
  /**
   * @deprecated → `showBreakIncidents` / `showCrashIncidents`.
   * При load: если новых ключей нет, оба наследуют это значение.
   */
  showIncidents?: boolean;
  /** Жёлтый break (`incident.type=break`) на Connection. */
  showBreakIncidents?: boolean;
  /** Красный crash (`incident.type=crash`) на Connection. */
  showCrashIncidents?: boolean;
  /** Schedule void mask вне desired на Connection. */
  showScheduleMask?: boolean;
  /**
   * Цветные эпизоды из gaps `link_liveness` (не journal).
   * Mutex с showBreak/CrashIncidents: при true инциденты off.
   */
  showWorkGaps?: boolean;
  /** WriteGap (recovery-красный) на дорожке инструмента. */
  showWriteGaps?: boolean;
}

const EMPTY: PersistedViewState = {
  activeConnectionId: null,
  activeFilters: [],
  expandedFutures: [],
  expandedSeries: [],
};

const VALID_FILTERS: readonly FilterKey[] = ['instruments', 'selection', 'exchanges', 'baskets'];

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    : [];
}

const TIMEFRAME_UNITS: readonly string[] = ['D', 'W', 'M', 'Q', 'Y'];

function parseTimeframe(value: unknown): Timeframe | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const t = value as Record<string, unknown>;
  if (t.kind === 'all') {
    return { kind: 'all' };
  }
  if (
    t.kind === 'sessions' &&
    typeof t.unit === 'string' &&
    TIMEFRAME_UNITS.includes(t.unit) &&
    typeof t.count === 'number' &&
    typeof t.includeWeekends === 'boolean'
  ) {
    return { kind: 'sessions', unit: t.unit as TimeframeUnit, count: t.count, includeWeekends: t.includeWeekends };
  }
  if (
    t.kind === 'range' &&
    typeof t.from === 'string' &&
    typeof t.to === 'string' &&
    typeof t.includeWeekends === 'boolean'
  ) {
    return { kind: 'range', from: t.from, to: t.to, includeWeekends: t.includeWeekends };
  }
  return undefined;
}

function parseSession(value: unknown): SessionWindowMode | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const s = value as Record<string, unknown>;
  switch (s.mode) {
    case 'none':
      return { mode: 'none' };
    case 'smart':
      return { mode: 'smart' };
    case 'session':
      return typeof s.exchange === 'string' ? { mode: 'session', exchange: s.exchange } : undefined;
    case 'custom':
      return typeof s.fromMin === 'number' && typeof s.toMin === 'number'
        ? { mode: 'custom', fromMin: s.fromMin, toMin: s.toMin }
        : undefined;
    default:
      return undefined;
  }
}

function parseTimeline(value: unknown): PersistedTimeline | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const t = value as Record<string, unknown>;
  const session = parseSession(t.session);
  if (!session) {
    return undefined;
  }
  return {
    weekdays: asNumberArray(t.weekdays).filter((n) => n >= 0 && n <= 6),
    fullDay: typeof t.fullDay === 'boolean' ? t.fullDay : false,
    session,
  };
}

function parseDisplayTz(value: unknown): DisplayTz | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const d = value as Record<string, unknown>;
  if ((d.preset === 'utc' || d.preset === 'msk' || d.preset === 'custom') && typeof d.offsetMin === 'number') {
    return { preset: d.preset, offsetMin: d.offsetMin };
  }
  return undefined;
}

function asSeries(value: unknown): PersistedSeries[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((raw) => {
    if (raw && typeof raw === 'object') {
      const s = raw as Record<string, unknown>;
      if (typeof s.futuresId === 'number' && typeof s.expiration === 'string') {
        return [{ futuresId: s.futuresId, expiration: s.expiration }];
      }
    }
    return [];
  });
}

/** Читает сохранённое представление (мягко: любые повреждённые поля → значения по умолчанию). */
export function loadViewState(): PersistedViewState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...EMPTY };
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      activeConnectionId:
        typeof parsed.activeConnectionId === 'number' ? parsed.activeConnectionId : null,
      activeFilters: asStringArray(parsed.activeFilters).filter((k): k is FilterKey =>
        (VALID_FILTERS as readonly string[]).includes(k),
      ),
      category: typeof parsed.category === 'string' ? parsed.category : undefined,
      onlyRecording: typeof parsed.onlyRecording === 'boolean' ? parsed.onlyRecording : undefined,
      nonEmpty: typeof parsed.nonEmpty === 'boolean' ? parsed.nonEmpty : undefined,
      selected: typeof parsed.selected === 'boolean' ? parsed.selected : undefined,
      selectionScope:
        parsed.selectionScope === 'base' || parsed.selectionScope === 'all'
          ? parsed.selectionScope
          : undefined,
      exchanges: Array.isArray(parsed.exchanges) ? asStringArray(parsed.exchanges) : undefined,
      expandedFutures: asNumberArray(parsed.expandedFutures),
      expandedSeries: asSeries(parsed.expandedSeries),
      timeframe: parseTimeframe(parsed.timeframe),
      dPlus: typeof parsed.dPlus === 'boolean' ? parsed.dPlus : undefined,
      timeline: parseTimeline(parsed.timeline),
      displayTz: parseDisplayTz(parsed.displayTz),
      crosshair: typeof parsed.crosshair === 'boolean' ? parsed.crosshair : undefined,
      highlightDays: typeof parsed.highlightDays === 'boolean' ? parsed.highlightDays : undefined,
      showFilters: typeof parsed.showFilters === 'boolean' ? parsed.showFilters : undefined,
      showNowMarker: typeof parsed.showNowMarker === 'boolean' ? parsed.showNowMarker : undefined,
      showLinkRibbon: typeof parsed.showLinkRibbon === 'boolean' ? parsed.showLinkRibbon : undefined,
      showRuler: typeof parsed.showRuler === 'boolean' ? parsed.showRuler : undefined,
      showIncidents: typeof parsed.showIncidents === 'boolean' ? parsed.showIncidents : undefined,
      showBreakIncidents:
        typeof parsed.showBreakIncidents === 'boolean'
          ? parsed.showBreakIncidents
          : typeof parsed.showIncidents === 'boolean'
            ? parsed.showIncidents
            : undefined,
      showCrashIncidents:
        typeof parsed.showCrashIncidents === 'boolean'
          ? parsed.showCrashIncidents
          : typeof parsed.showIncidents === 'boolean'
            ? parsed.showIncidents
            : undefined,
      showScheduleMask:
        typeof parsed.showScheduleMask === 'boolean' ? parsed.showScheduleMask : undefined,
      showWorkGaps: typeof parsed.showWorkGaps === 'boolean' ? parsed.showWorkGaps : undefined,
      showWriteGaps: typeof parsed.showWriteGaps === 'boolean' ? parsed.showWriteGaps : undefined,
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Сохраняет текущее представление каталога. */
export function persistViewState(state: PersistedViewState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage недоступен (приватный режим, тесты) — игнорируем.
  }
}
