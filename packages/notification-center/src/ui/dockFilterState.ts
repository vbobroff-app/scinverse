import type {
  NotificationInteraction,
  NotificationLocalization,
  NotificationSeverity,
  NotificationStatus,
} from '../types';
import { EMPTY_DOCK_RANGE, type DockRangeFilter } from '../filter/dateRange';

export type DockFilterKey = 'severity' | 'interaction' | 'localization' | 'status' | 'range';

export interface DockFilterState {
  severities: NotificationSeverity[];
  interactions: NotificationInteraction[];
  localizations: NotificationLocalization[];
  statuses: NotificationStatus[];
  range: DockRangeFilter;
  query: string;
}

export const EMPTY_DOCK_FILTER: DockFilterState = {
  severities: [],
  interactions: [],
  localizations: [],
  statuses: [],
  range: { ...EMPTY_DOCK_RANGE },
  query: '',
};

/** Гарантирует полный DockFilterState (старые снимки без `range`/`statuses`). */
export function normalizeDockFilter(
  value: Partial<DockFilterState> | null | undefined,
): DockFilterState {
  return {
    severities: value?.severities ?? [],
    interactions: value?.interactions ?? [],
    localizations: value?.localizations ?? [],
    statuses: value?.statuses ?? [],
    range: value?.range ?? { ...EMPTY_DOCK_RANGE },
    query: value?.query ?? '',
  };
}

export interface DockFiltersSnapshot {
  filter: DockFilterState;
  activeFilters: DockFilterKey[];
}
