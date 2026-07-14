import type { NotificationEvent, NotificationFilter, NotificationSeverity, NotificationSourceType } from '../types';

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

/** Клиентская фильтрация ленты (severity ∧ sourceType ∧ module ∧ query). */
export function filterEvents(
  events: readonly NotificationEvent[],
  filter: NotificationFilter = {},
): NotificationEvent[] {
  const severities = toSet<NotificationSeverity>(filter.severities);
  const sourceTypes = toSet<NotificationSourceType>(filter.sourceTypes);
  const modules = toSet<string>(filter.modules);
  const query = filter.query?.trim().toLowerCase() ?? '';

  if (!severities && !sourceTypes && !modules && !query) {
    return events.slice();
  }

  return events.filter((evt) => {
    if (severities && !severities.has(evt.severity)) {
      return false;
    }
    if (sourceTypes && !sourceTypes.has(evt.sourceType)) {
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
    return true;
  });
}
