import type {
  NotificationInteraction,
  NotificationLocalization,
  NotificationSeverity,
} from '../types';
import { EMPTY_DOCK_RANGE, type DockRangeFilter } from '../filter/dateRange';

export type DockFilterKey = 'severity' | 'interaction' | 'localization' | 'range';

export interface DockFilterState {
  severities: NotificationSeverity[];
  interactions: NotificationInteraction[];
  localizations: NotificationLocalization[];
  range: DockRangeFilter;
  query: string;
}

export const EMPTY_DOCK_FILTER: DockFilterState = {
  severities: [],
  interactions: [],
  localizations: [],
  range: { ...EMPTY_DOCK_RANGE },
  query: '',
};

/** Гарантирует полный DockFilterState (старые снимки без `range`). */
export function normalizeDockFilter(
  value: Partial<DockFilterState> | null | undefined,
): DockFilterState {
  return {
    severities: value?.severities ?? [],
    interactions: value?.interactions ?? [],
    localizations: value?.localizations ?? [],
    range: value?.range ?? { ...EMPTY_DOCK_RANGE },
    query: value?.query ?? '',
  };
}

export interface DockFiltersSnapshot {
  filter: DockFilterState;
  activeFilters: DockFilterKey[];
}
