import type {
  NotificationInteraction,
  NotificationLocalization,
  NotificationSeverity,
  NotificationStatus,
  ThreadStatus,
} from '../types';
import {
  EMPTY_CONNECTION_FILTER,
  normalizeConnectionFilter,
  type ConnectionDockFilter,
} from '../filter/connectionFilter';
import { EMPTY_DOCK_RANGE, type DockRangeFilter } from '../filter/dateRange';
import type { NcChoiceFilter } from '../filter/filterItems';

export type { ConnectionDockFilter } from '../filter/connectionFilter';
export {
  EMPTY_CONNECTION_FILTER,
  connectionFilterSummary,
  isConnectionFilterDefault,
  normalizeConnectionFilter,
  parseConnectionFilterId,
} from '../filter/connectionFilter';

export type DockFilterKey =
  | 'severity'
  | 'interaction'
  | 'localization'
  | 'status'
  | 'threadStatus'
  | 'choice'
  | 'connection'
  | 'range';

export interface DockFilterState {
  severities: NotificationSeverity[];
  interactions: NotificationInteraction[];
  localizations: NotificationLocalization[];
  statuses: NotificationStatus[];
  /** Статус нити (только Thread). */
  threadStatuses: ThreadStatus[];
  /** Выбор: ★ favorite (include) / ⊘ left=спам (exclude). */
  choices: NcChoiceFilter[];
  connection: ConnectionDockFilter;
  range: DockRangeFilter;
  query: string;
}

export const EMPTY_DOCK_FILTER: DockFilterState = {
  severities: [],
  interactions: [],
  localizations: [],
  statuses: [],
  threadStatuses: [],
  choices: [],
  connection: { ...EMPTY_CONNECTION_FILTER },
  range: { ...EMPTY_DOCK_RANGE },
  query: '',
};

/** Гарантирует полный DockFilterState (старые снимки без новых полей). */
export function normalizeDockFilter(
  value: Partial<DockFilterState> | null | undefined,
): DockFilterState {
  return {
    severities: value?.severities ?? [],
    interactions: value?.interactions ?? [],
    localizations: value?.localizations ?? [],
    statuses: value?.statuses ?? [],
    threadStatuses: value?.threadStatuses ?? [],
    choices: value?.choices ?? [],
    connection: normalizeConnectionFilter(value?.connection),
    range: value?.range ?? { ...EMPTY_DOCK_RANGE },
    query: value?.query ?? '',
  };
}

export interface DockFiltersSnapshot {
  filter: DockFilterState;
  activeFilters: DockFilterKey[];
}
