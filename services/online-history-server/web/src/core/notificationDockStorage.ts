import { BehaviorSubject } from 'rxjs';
import type {
  ConnectionDockFilter,
  DockFilterKey,
  DockFilterState,
  DockRangeFilter,
  NcChoiceFilter,
  NotificationDockFiltersSnapshot,
  NotificationDockSettings,
  NotificationInteraction,
  NotificationLocalization,
  NotificationSeverity,
  NotificationStatus,
  ThreadStatus,
} from '@scinverse/notification-center';
import {
  DEFAULT_LAYER_FILTER,
  EMPTY_CONNECTION_FILTER,
  EMPTY_DOCK_RANGE,
  EMPTY_DOCK_SETTINGS,
  isDockRangePreset,
  normalizeConnectionFilter,
  normalizeDockFilter,
  normalizeDockSettings,
  normalizeLayerFilter,
  type LayerDockFilter,
} from '@scinverse/notification-center';

const STORAGE_KEY = 'ohs:notificationDock';

const VALID_ACTIVE: readonly DockFilterKey[] = [
  'severity',
  'interaction',
  'localization',
  'status',
  'threadStatus',
  'choice',
  'connection',
  'layers',
  'range',
];
const VALID_SEVERITIES: readonly NotificationSeverity[] = [
  'ok',
  'info',
  'warning',
  'error',
  'critical',
];
const VALID_INTERACTIONS: readonly NotificationInteraction[] = ['user', 'system'];
const VALID_LOCALIZATIONS: readonly NotificationLocalization[] = ['internal', 'external'];
const VALID_STATUSES: readonly NotificationStatus[] = ['active', 'underway', 'resolved'];
const VALID_THREAD_STATUSES: readonly ThreadStatus[] = ['active', 'recovering', 'resolved'];
const VALID_CHOICES: readonly NcChoiceFilter[] = ['favorite', 'left', 'deleted'];

export interface PersistedNotificationDock {
  open: boolean;
  /** Expanded (список) vs Collapsed (только заголовок). */
  expanded: boolean;
  filter: DockFilterState;
  activeFilters: DockFilterKey[];
  settings: NotificationDockSettings;
}

function emptyFilter(): DockFilterState {
  return {
    severities: [],
    interactions: [],
    localizations: [],
    statuses: [],
    threadStatuses: [],
    choices: [],
    connection: { ...EMPTY_CONNECTION_FILTER },
    layers: { ...DEFAULT_LAYER_FILTER },
    range: { ...EMPTY_DOCK_RANGE },
    query: '',
  };
}

function parseLayers(raw: unknown): LayerDockFilter {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_LAYER_FILTER };
  }
  return normalizeLayerFilter(raw as Partial<LayerDockFilter>);
}

function parseConnection(raw: unknown): ConnectionDockFilter {
  if (!raw || typeof raw !== 'object') {
    return { ...EMPTY_CONNECTION_FILTER };
  }
  return normalizeConnectionFilter(raw as Partial<ConnectionDockFilter>);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function parseYmd(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const t = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : undefined;
}

function parseRange(raw: unknown): DockRangeFilter {
  if (!raw || typeof raw !== 'object') {
    return { ...EMPTY_DOCK_RANGE };
  }
  const r = raw as Record<string, unknown>;
  if (!isDockRangePreset(r.preset)) {
    return { ...EMPTY_DOCK_RANGE };
  }
  const time: Pick<DockRangeFilter, 'timeEnabled' | 'timeFrom' | 'timeTo'> = {};
  if (r.timeEnabled === true) {
    time.timeEnabled = true;
  }
  if (typeof r.timeFrom === 'string' && r.timeFrom.trim()) {
    time.timeFrom = r.timeFrom.trim();
  }
  if (typeof r.timeTo === 'string' && r.timeTo.trim()) {
    time.timeTo = r.timeTo.trim();
  }
  if (r.preset === 'custom') {
    return {
      preset: 'custom',
      from: parseYmd(r.from),
      to: parseYmd(r.to),
      ...time,
    };
  }
  return { preset: r.preset, ...time };
}

function parseFilter(raw: unknown): DockFilterState {
  if (!raw || typeof raw !== 'object') {
    return emptyFilter();
  }
  const f = raw as Record<string, unknown>;
  return {
    severities: asStringArray(f.severities).filter((s): s is NotificationSeverity =>
      (VALID_SEVERITIES as readonly string[]).includes(s),
    ),
    interactions: asStringArray(f.interactions).filter((s): s is NotificationInteraction =>
      (VALID_INTERACTIONS as readonly string[]).includes(s),
    ),
    localizations: asStringArray(f.localizations).filter((s): s is NotificationLocalization =>
      (VALID_LOCALIZATIONS as readonly string[]).includes(s),
    ),
    statuses: asStringArray(f.statuses).filter((s): s is NotificationStatus =>
      (VALID_STATUSES as readonly string[]).includes(s),
    ),
    threadStatuses: asStringArray(f.threadStatuses).filter((s): s is ThreadStatus =>
      (VALID_THREAD_STATUSES as readonly string[]).includes(s),
    ),
    choices: asStringArray(f.choices).filter((s): s is NcChoiceFilter =>
      (VALID_CHOICES as readonly string[]).includes(s),
    ),
    connection: parseConnection(f.connection),
    layers: parseLayers(f.layers),
    range: parseRange(f.range),
    query: typeof f.query === 'string' ? f.query : '',
  };
}

function parseActive(raw: unknown): DockFilterKey[] {
  return asStringArray(raw).filter((k): k is DockFilterKey =>
    (VALID_ACTIVE as readonly string[]).includes(k),
  );
}

function cloneFilter(filter: DockFilterState): DockFilterState {
  const range = filter.range ?? { ...EMPTY_DOCK_RANGE };
  const nextRange: DockRangeFilter = {
    preset: range.preset ?? 'all',
  };
  if (range.from) {
    nextRange.from = range.from;
  }
  if (range.to) {
    nextRange.to = range.to;
  }
  if (range.timeEnabled) {
    nextRange.timeEnabled = true;
  }
  if (range.timeFrom) {
    nextRange.timeFrom = range.timeFrom;
  }
  if (range.timeTo) {
    nextRange.timeTo = range.timeTo;
  }
  return {
    severities: [...(filter.severities ?? [])],
    interactions: [...(filter.interactions ?? [])],
    localizations: [...(filter.localizations ?? [])],
    statuses: [...(filter.statuses ?? [])],
    threadStatuses: [...(filter.threadStatuses ?? [])],
    choices: [...(filter.choices ?? [])],
    connection: normalizeConnectionFilter(filter.connection),
    layers: normalizeLayerFilter(filter.layers),
    range: nextRange,
    query: filter.query ?? '',
  };
}

function readStorage(): PersistedNotificationDock {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        open: parsed.open === true,
        expanded: parsed.expanded === true,
        filter: parseFilter(parsed.filter),
        activeFilters: parseActive(parsed.activeFilters),
        settings: normalizeDockSettings(parsed.settings as Partial<NotificationDockSettings>),
      };
    }
    const legacy = localStorage.getItem('ohs:notificationDockFilters');
    if (legacy) {
      const parsed = JSON.parse(legacy) as Record<string, unknown>;
      return {
        open: false,
        expanded: false,
        filter: parseFilter(parsed.filter),
        activeFilters: parseActive(parsed.activeFilters),
        settings: { ...EMPTY_DOCK_SETTINGS },
      };
    }
  } catch {
    /* ignore */
  }
  return {
    open: false,
    expanded: false,
    filter: emptyFilter(),
    activeFilters: [],
    settings: { ...EMPTY_DOCK_SETTINGS },
  };
}

function writeStorage(state: PersistedNotificationDock): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        open: state.open,
        expanded: state.expanded,
        filter: state.filter,
        activeFilters: state.activeFilters,
        settings: state.settings,
      }),
    );
    localStorage.removeItem('ohs:notificationDockFilters');
  } catch {
    /* ignore */
  }
}

/**
 * Store дока уведомлений — как OhsStore для фильтров провайдеров:
 * состояние в BehaviorSubject, каждый мутатор пишет полный снимок в localStorage из памяти
 * (без read-modify-write, чтобы open/filters не затирали друг друга).
 */
class NotificationDockStore {
  readonly open$: BehaviorSubject<boolean>;
  readonly expanded$: BehaviorSubject<boolean>;
  readonly filter$: BehaviorSubject<DockFilterState>;
  readonly activeFilters$: BehaviorSubject<DockFilterKey[]>;
  readonly settings$: BehaviorSubject<NotificationDockSettings>;

  constructor() {
    const v = readStorage();
    this.open$ = new BehaviorSubject(v.open);
    this.expanded$ = new BehaviorSubject(v.expanded);
    this.filter$ = new BehaviorSubject(v.filter);
    this.activeFilters$ = new BehaviorSubject(v.activeFilters);
    this.settings$ = new BehaviorSubject(v.settings);
  }

  /** Полный persist из текущего состояния в RAM — как OhsStore.persistView(). */
  private persist(): void {
    writeStorage({
      open: this.open$.value,
      expanded: this.expanded$.value,
      activeFilters: [...this.activeFilters$.value],
      filter: cloneFilter(this.filter$.value),
      settings: normalizeDockSettings(this.settings$.value),
    });
  }

  setOpen(open: boolean): void {
    if (this.open$.value === open) {
      return;
    }
    this.open$.next(open);
    this.persist();
  }

  toggleOpen(): void {
    this.setOpen(!this.open$.value);
  }

  setExpanded(expanded: boolean): void {
    if (this.expanded$.value === expanded) {
      return;
    }
    this.expanded$.next(expanded);
    this.persist();
  }

  setFilter(filter: Partial<DockFilterState>): void {
    this.filter$.next(cloneFilter(normalizeDockFilter(filter)));
    this.persist();
  }

  setActiveFilters(keys: DockFilterKey[]): void {
    this.activeFilters$.next([...keys]);
    this.persist();
  }

  setSettings(settings: Partial<NotificationDockSettings>): void {
    const next = normalizeDockSettings(settings);
    const enablingTray = next.sendToTray && !this.settings$.value.sendToTray;
    const collapseChanged =
      next.collapsePhaseTicks !== this.settings$.value.collapsePhaseTicks;
    this.settings$.next(next);
    this.persist();
    if (enablingTray) {
      void import('./notifications').then((m) => m.ensureTrayPermission());
    }
    if (collapseChanged) {
      void import('./notifications').then((m) =>
        m.notificationBus.setCollapsePhaseTicks(next.collapsePhaseTicks));
    }
  }

  /** Применить снимок фильтров целиком (значение + плашки) одним persist. */
  applyFiltersSnapshot(snapshot: {
    filter: Partial<DockFilterState>;
    activeFilters: DockFilterKey[];
  }): void {
    this.filter$.next(cloneFilter(normalizeDockFilter(snapshot.filter)));
    this.activeFilters$.next([...snapshot.activeFilters]);
    this.persist();
  }

  addFilter(key: DockFilterKey): void {
    if (this.activeFilters$.value.includes(key)) {
      return;
    }
    this.activeFilters$.next([...this.activeFilters$.value, key]);
    if (key === 'range') {
      const range = this.filter$.value.range;
      if (!range || range.preset === 'all') {
        this.filter$.next(cloneFilter({ ...this.filter$.value, range: { preset: 'today' } }));
      }
    }
    this.persist();
  }

  removeFilter(key: DockFilterKey): void {
    this.activeFilters$.next(this.activeFilters$.value.filter((k) => k !== key));
    const f = this.filter$.value;
    if (key === 'severity') {
      this.filter$.next({ ...f, severities: [] });
    } else if (key === 'interaction') {
      this.filter$.next({ ...f, interactions: [] });
    } else if (key === 'localization') {
      this.filter$.next({ ...f, localizations: [] });
    } else if (key === 'status') {
      this.filter$.next({ ...f, statuses: [] });
    } else if (key === 'threadStatus') {
      this.filter$.next({ ...f, threadStatuses: [] });
    } else if (key === 'choice') {
      this.filter$.next({ ...f, choices: [] });
    } else if (key === 'connection') {
      this.filter$.next({ ...f, connection: { ...EMPTY_CONNECTION_FILTER } });
    } else if (key === 'layers') {
      this.filter$.next({ ...f, layers: { ...DEFAULT_LAYER_FILTER } });
    } else if (key === 'range') {
      this.filter$.next({ ...f, range: { ...EMPTY_DOCK_RANGE } });
    }
    this.persist();
  }

  clearFilters(): void {
    this.activeFilters$.next([]);
    this.filter$.next({
      severities: [],
      interactions: [],
      localizations: [],
      statuses: [],
      threadStatuses: [],
      choices: [],
      connection: { ...EMPTY_CONNECTION_FILTER },
      layers: { ...DEFAULT_LAYER_FILTER },
      range: { ...EMPTY_DOCK_RANGE },
      query: this.filter$.value.query,
    });
    this.persist();
  }

  /** Для тестов / отладки. */
  snapshot(): PersistedNotificationDock {
    return {
      open: this.open$.value,
      expanded: this.expanded$.value,
      activeFilters: [...this.activeFilters$.value],
      filter: cloneFilter(this.filter$.value),
      settings: normalizeDockSettings(this.settings$.value),
    };
  }
}

/**
 * Синглтон на globalThis — переживает Vite HMR.
 * Иначе после hot-reload появляются два store и toggle open со старого
 * затирает фильтры в localStorage пустым снимком.
 */
const globalStoreKey = '__scinverseOhsNotificationDockStore_v9';

function getOrCreateStore(): NotificationDockStore {
  const g = globalThis as unknown as Record<string, NotificationDockStore | undefined>;
  if (!g[globalStoreKey]) {
    g[globalStoreKey] = new NotificationDockStore();
  }
  return g[globalStoreKey];
}

export const notificationDockStore = getOrCreateStore();

export { STORAGE_KEY as NOTIFICATION_DOCK_STORAGE_KEY };

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    /* store остаётся на globalThis */
  });
}

/** @deprecated используйте notificationDockStore; оставлено для тестов load-парсера */
export function loadNotificationDock(): PersistedNotificationDock {
  return readStorage();
}

export function loadNotificationDockFilters(): NotificationDockFiltersSnapshot {
  const s = readStorage();
  return { filter: s.filter, activeFilters: s.activeFilters };
}
