const SHOW_DELETED_KEY = 'ohs:incidentsJournal:showDeleted';
const MODAL_FILTERS_KEY = 'ohs:incidentsJournal:modalFilters';

const STATUS_IDS = ['active', 'recovering', 'resolved', 'deleted'] as const;
const OUTCOME_IDS = ['recovered', 'abandoned_manual', 'recovered_manual'] as const;
const FILTER_KEYS = ['status', 'outcome'] as const;

export type IncidentsModalFilterKey = (typeof FILTER_KEYS)[number];

export interface IncidentsModalFiltersState {
  /** Плашки, добавленные через [+] (порядок = порядок добавления). */
  activeFilters: IncidentsModalFilterKey[];
  statuses: string[];
  outcomes: string[];
}

export const DEFAULT_INCIDENTS_MODAL_FILTERS: IncidentsModalFiltersState = {
  activeFilters: [],
  statuses: [...STATUS_IDS],
  outcomes: [...OUTCOME_IDS],
};

/** Галка «Показывать удалённые» в журнале (модалка + страница). */
export function loadIncidentsShowDeleted(): boolean {
  try {
    return localStorage.getItem(SHOW_DELETED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveIncidentsShowDeleted(show: boolean): void {
  try {
    localStorage.setItem(SHOW_DELETED_KEY, show ? '1' : '0');
  } catch {
    // ignore quota / private mode
  }
}

/** Плашки Статус/Исход + набор запущенных через [+] в модалке connection-журнала. */
export function loadIncidentsModalFilters(): IncidentsModalFiltersState {
  try {
    const raw = localStorage.getItem(MODAL_FILTERS_KEY);
    if (!raw) return { ...cloneDefault() };
    return normalizeModalFilters(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return cloneDefault();
  }
}

export function saveIncidentsModalFilters(state: IncidentsModalFiltersState): void {
  try {
    localStorage.setItem(MODAL_FILTERS_KEY, JSON.stringify(normalizeModalFilters(state)));
  } catch {
    // ignore quota / private mode
  }
}

function cloneDefault(): IncidentsModalFiltersState {
  return {
    activeFilters: [],
    statuses: [...STATUS_IDS],
    outcomes: [...OUTCOME_IDS],
  };
}

function normalizeModalFilters(
  raw: Partial<IncidentsModalFiltersState> & { active?: unknown },
): IncidentsModalFiltersState {
  // legacy: поле называлось `active`
  const activeRaw = raw.activeFilters ?? raw.active;
  const activeFilters = Array.isArray(activeRaw)
    ? activeRaw.filter((k): k is IncidentsModalFilterKey =>
        typeof k === 'string' && (FILTER_KEYS as readonly string[]).includes(k),
      )
    : [];
  const statuses = sanitizeIds(raw.statuses, STATUS_IDS) ?? [...STATUS_IDS];
  const outcomes = sanitizeIds(raw.outcomes, OUTCOME_IDS) ?? [...OUTCOME_IDS];
  return { activeFilters, statuses, outcomes };
}

function sanitizeIds(
  value: unknown,
  allowed: readonly string[],
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const next = value.filter(
    (id): id is string => typeof id === 'string' && allowed.includes(id),
  );
  return allowed.filter((id) => next.includes(id));
}
