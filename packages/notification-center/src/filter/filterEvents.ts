import type {
  NotificationEvent,
  NotificationFilter,
  NotificationInteraction,
  NotificationLocalization,
  NotificationSeverity,
  NotificationSourceType,
  NotificationStatus,
} from '../types';
import { resolveInteraction, resolveLocalization, resolveStatus } from '../types';
import type { DockRangeFilter, RangeBounds } from './dateRange';
import { resolveRangeBounds } from './dateRange';

function toSet<T extends string>(value: ReadonlySet<T> | readonly T[] | undefined): Set<T> | null {
  if (!value) {
    return null;
  }
  if (value instanceof Set) {
    return value.size === 0 ? null : value;
  }
  const arr = value as readonly T[];
  return arr.length === 0 ? null : new Set(arr);
}

function isRangeBounds(range: DockRangeFilter | RangeBounds): range is RangeBounds {
  return 'fromMs' in range;
}

function resolveFilterBounds(
  range: DockRangeFilter | RangeBounds | undefined,
  now?: Date,
): RangeBounds | null {
  if (!range) {
    return null;
  }
  const bounds = isRangeBounds(range) ? range : resolveRangeBounds(range, now);
  if (bounds.fromMs == null && bounds.toMs == null) {
    return null;
  }
  return bounds;
}

function inRange(ts: string, bounds: RangeBounds): boolean {
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) {
    return false;
  }
  if (bounds.fromMs != null && ms < bounds.fromMs) {
    return false;
  }
  if (bounds.toMs != null && ms > bounds.toMs) {
    return false;
  }
  return true;
}

/** Клиентская фильтрация ленты (severity ∧ interaction ∧ localization ∧ module ∧ query ∧ range). */
export function filterEvents(
  events: readonly NotificationEvent[],
  filter: NotificationFilter = {},
  now?: Date,
): NotificationEvent[] {
  const severities = toSet<NotificationSeverity>(filter.severities);
  const sourceTypes = toSet<NotificationSourceType>(filter.sourceTypes);
  const interactions = toSet<NotificationInteraction>(filter.interactions);
  const localizations = toSet<NotificationLocalization>(filter.localizations);
  const statuses = toSet<NotificationStatus>(filter.statuses);
  const modules = toSet<string>(filter.modules);
  const query = filter.query?.trim().toLowerCase() ?? '';
  const bounds = resolveFilterBounds(filter.range, now);

  if (
    !severities &&
    !sourceTypes &&
    !interactions &&
    !localizations &&
    !statuses &&
    !modules &&
    !query &&
    !bounds
  ) {
    return events.slice();
  }

  return events.filter((evt) => {
    if (severities && !severities.has(evt.severity)) {
      return false;
    }
    if (sourceTypes && !sourceTypes.has(evt.sourceType)) {
      return false;
    }
    if (interactions && !interactions.has(resolveInteraction(evt))) {
      return false;
    }
    if (localizations && !localizations.has(resolveLocalization(evt))) {
      return false;
    }
    if (statuses && !statuses.has(resolveStatus(evt))) {
      return false;
    }
    if (modules && !modules.has(evt.module)) {
      return false;
    }
    if (query) {
      const hay = `${evt.message} ${evt.code} ${evt.module}`.toLowerCase();
      if (!hay.includes(query)) {
        return false;
      }
    }
    if (bounds && !inRange(evt.ts, bounds)) {
      return false;
    }
    return true;
  });
}
