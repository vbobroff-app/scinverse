import { BehaviorSubject } from 'rxjs';
import type {
  DockFilterKey,
  DockFilterState,
  NotificationDockFiltersSnapshot,
  NotificationInteraction,
  NotificationLocalization,
  NotificationSeverity,
} from '@scinverse/notification-center';

const STORAGE_KEY = 'ohs:notificationDock';

const VALID_ACTIVE: readonly DockFilterKey[] = ['severity', 'interaction', 'localization'];
const VALID_SEVERITIES: readonly NotificationSeverity[] = [
  'ok',
  'info',
  'warning',
  'error',
  'critical',
];
const VALID_INTERACTIONS: readonly NotificationInteraction[] = ['user', 'system', 'resolving'];
const VALID_LOCALIZATIONS: readonly NotificationLocalization[] = ['internal', 'external'];

export interface PersistedNotificationDock {
  open: boolean;
  /** Expanded (список) vs Collapsed (только заголовок). */
  expanded: boolean;
  filter: DockFilterState;
  activeFilters: DockFilterKey[];
}

function emptyFilter(): DockFilterState {
  return { severities: [], interactions: [], localizations: [], query: '' };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
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
    query: typeof f.query === 'string' ? f.query : '',
  };
}

function parseActive(raw: unknown): DockFilterKey[] {
  return asStringArray(raw).filter((k): k is DockFilterKey =>
    (VALID_ACTIVE as readonly string[]).includes(k),
  );
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
      };
    }
  } catch {
    /* ignore */
  }
  return { open: false, expanded: false, filter: emptyFilter(), activeFilters: [] };
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

  constructor() {
    const v = readStorage();
    this.open$ = new BehaviorSubject(v.open);
    this.expanded$ = new BehaviorSubject(v.expanded);
    this.filter$ = new BehaviorSubject(v.filter);
    this.activeFilters$ = new BehaviorSubject(v.activeFilters);
  }

  /** Полный persist из текущего состояния в RAM — как OhsStore.persistView(). */
  private persist(): void {
    const f = this.filter$.value;
    writeStorage({
      open: this.open$.value,
      expanded: this.expanded$.value,
      activeFilters: [...this.activeFilters$.value],
      filter: {
        severities: [...f.severities],
        interactions: [...f.interactions],
        localizations: [...f.localizations],
        query: f.query,
      },
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

  setFilter(filter: DockFilterState): void {
    this.filter$.next({
      severities: [...filter.severities],
      interactions: [...filter.interactions],
      localizations: [...filter.localizations],
      query: filter.query,
    });
    this.persist();
  }

  setActiveFilters(keys: DockFilterKey[]): void {
    this.activeFilters$.next([...keys]);
    this.persist();
  }

  /** Применить снимок фильтров целиком (значение + плашки) одним persist. */
  applyFiltersSnapshot(snapshot: NotificationDockFiltersSnapshot): void {
    this.filter$.next({
      severities: [...snapshot.filter.severities],
      interactions: [...snapshot.filter.interactions],
      localizations: [...snapshot.filter.localizations],
      query: snapshot.filter.query,
    });
    this.activeFilters$.next([...snapshot.activeFilters]);
    this.persist();
  }

  addFilter(key: DockFilterKey): void {
    if (this.activeFilters$.value.includes(key)) {
      return;
    }
    this.activeFilters$.next([...this.activeFilters$.value, key]);
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
    }
    this.persist();
  }

  clearFilters(): void {
    this.activeFilters$.next([]);
    this.filter$.next({
      severities: [],
      interactions: [],
      localizations: [],
      query: this.filter$.value.query,
    });
    this.persist();
  }

  /** Для тестов / отладки. */
  snapshot(): PersistedNotificationDock {
    const f = this.filter$.value;
    return {
      open: this.open$.value,
      expanded: this.expanded$.value,
      activeFilters: [...this.activeFilters$.value],
      filter: {
        severities: [...f.severities],
        interactions: [...f.interactions],
        localizations: [...f.localizations],
        query: f.query,
      },
    };
  }
}

/**
 * Синглтон на globalThis — переживает Vite HMR.
 * Иначе после hot-reload появляются два store и toggle open со старого
 * затирает фильтры в localStorage пустым снимком.
 */
const globalStoreKey = '__scinverseOhsNotificationDockStore_v2';

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
