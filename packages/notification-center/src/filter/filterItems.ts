import type {
  NotificationEvent,
  NotificationFilter,
  NotificationItem,
  ThreadItem,
  ThreadStatus,
} from '../types';
import { filterEvents } from './filterEvents';
import {
  parseConnectionFilterId,
  type ConnectionDockFilter,
} from './connectionFilter';
import {
  classifyItemLayer,
  matchesLayerFilter,
  type LayerDockFilter,
} from './layerFilter';

export type NcChoiceFilter = 'favorite' | 'left';

/** Фильтр ленты контейнеров (атомы + threadStatus + Выбор + connectionId + слой). */
export interface NotificationItemFilter extends NotificationFilter {
  threadStatuses?: ReadonlySet<ThreadStatus> | readonly ThreadStatus[];
  choices?: ReadonlySet<NcChoiceFilter> | readonly NcChoiceFilter[];
  /** Show/hide Id только для слоя CL; hide побеждает show. */
  connection?: ConnectionDockFilter;
  /** Слои TL/CL/WL; ортогонально break/crash toggles. */
  layers?: LayerDockFilter;
}

/** Прочитать `data.connectionId` (number | numeric string). */
export function readConnectionId(data: Record<string, unknown> | null | undefined): number | undefined {
  if (!data) {
    return undefined;
  }
  const raw = data.connectionId;
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 1) {
    return raw;
  }
  if (typeof raw === 'string') {
    return parseConnectionFilterId(raw);
  }
  return undefined;
}

/** P5.2: `data.connectionIds` (transport crash scope) + legacy `connectionId`. */
export function readConnectionIds(data: Record<string, unknown> | null | undefined): number[] {
  if (!data) {
    return [];
  }
  const out = new Set<number>();
  const single = readConnectionId(data);
  if (single != null) {
    out.add(single);
  }
  const raw = data.connectionIds;
  if (Array.isArray(raw)) {
    for (const el of raw) {
      if (typeof el === 'number' && Number.isSafeInteger(el) && el >= 1) {
        out.add(el);
      } else if (typeof el === 'string') {
        const id = parseConnectionFilterId(el);
        if (id != null) {
          out.add(id);
        }
      }
    }
  }
  return [...out];
}

function itemConnectionIds(item: NotificationItem): number[] {
  if (item.itemKind === 'single') {
    return readConnectionIds(item.data);
  }
  const ids = new Set<number>();
  for (const e of item.notifications) {
    for (const id of readConnectionIds(e.data)) {
      ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Фильтр «Коннекторы»: show/hide Id только для слоя CL.
 * TL/WL (в т.ч. crash с `connectionIds`) не режутся — их видимость = «Слои».
 * Hide побеждает show.
 */
export function matchesConnectionFilter(
  item: NotificationItem,
  connection: ConnectionDockFilter | undefined,
): boolean {
  if (!connection) {
    return true;
  }
  const hideId = parseConnectionFilterId(connection.hideIdText);
  const showId = parseConnectionFilterId(connection.showIdText);
  if (hideId == null && showId == null) {
    return true;
  }

  if (classifyItemLayer(item) !== 'cl') {
    return true;
  }

  const ids = itemConnectionIds(item);
  if (hideId != null && ids.includes(hideId)) {
    return false;
  }
  if (showId != null) {
    if (ids.length === 0) {
      return true;
    }
    return ids.includes(showId);
  }
  return true;
}

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

function eventMatches(
  evt: NotificationEvent,
  atomFilter: NotificationFilter,
  now?: Date,
): boolean {
  return filterEvents([evt], atomFilter, now).length > 0;
}

function headerMatchesQuery(thread: ThreadItem, query: string): boolean {
  if (!query) {
    return true;
  }
  const hay = `${thread.header.title} ${thread.header.summary ?? ''} ${thread.uid} ${thread.subject ?? ''} ${thread.threadKind} ${thread.threadStatus}`.toLowerCase();
  return hay.includes(query);
}

function threadMatchesAtoms(
  thread: ThreadItem,
  atomFilter: NotificationFilter,
  now?: Date,
): boolean {
  const query = atomFilter.query?.trim().toLowerCase() ?? '';
  const withoutQuery: NotificationFilter = { ...atomFilter, query: undefined };
  const hasAtomConstraints = Boolean(
    atomFilter.severities ||
      atomFilter.sourceTypes ||
      atomFilter.interactions ||
      atomFilter.localizations ||
      atomFilter.statuses ||
      atomFilter.modules ||
      atomFilter.range,
  );

  const anyEntry = thread.notifications.some((e) => eventMatches(e, withoutQuery, now));
  if (hasAtomConstraints && !anyEntry) {
    return false;
  }

  if (query) {
    const entryHit = thread.notifications.some((e) => eventMatches(e, { query }, now));
    if (!entryHit && !headerMatchesQuery(thread, query)) {
      return false;
    }
  }

  // Если только query/пусто — и без atom constraints: пропускаем (уже проверили query).
  if (!hasAtomConstraints && !query) {
    return true;
  }
  if (!hasAtomConstraints && query) {
    return true;
  }
  return anyEntry || (query ? headerMatchesQuery(thread, query) : false);
}

/**
 * Фильтрация проекции Single | Thread.
 * `threadStatuses` — только Thread; при активном фильтре Single скрываются.
 * `choices` — асимметрия (см. docs/dev/phase11/nc-marks.md):
 *   ★ favorite — include; ⊘ left (спам) — exclude; при обеих ⊘ побеждает.
 * Маркеры на item уже агрегированы (Single = Entry; Thread header = any★ / all⊘).
 */
export function filterItems(
  items: readonly NotificationItem[],
  filter: NotificationItemFilter = {},
  now?: Date,
): NotificationItem[] {
  const threadStatuses = toSet<ThreadStatus>(filter.threadStatuses);
  const choices = toSet<NcChoiceFilter>(filter.choices);

  const atomFilter: NotificationFilter = {
    severities: filter.severities,
    sourceTypes: filter.sourceTypes,
    interactions: filter.interactions,
    localizations: filter.localizations,
    statuses: filter.statuses,
    modules: filter.modules,
    query: filter.query,
    range: filter.range,
    tzOffsetMin: filter.tzOffsetMin,
  };

  return items.filter((item) => {
    if (!matchesLayerFilter(item, filter.layers)) {
      return false;
    }

    if (!matchesConnectionFilter(item, filter.connection)) {
      return false;
    }

    if (choices) {
      const wantFav = choices.has('favorite');
      const hideSpam = choices.has('left');
      // ⊘ exclude — и побеждает ★, если обе галки on.
      if (hideSpam && item.isLeft) {
        return false;
      }
      if (wantFav && !item.isFavorite) {
        return false;
      }
    }

    if (item.itemKind === 'single') {
      if (threadStatuses) {
        return false;
      }
      return eventMatches(item, atomFilter, now);
    }

    if (threadStatuses && !threadStatuses.has(item.threadStatus)) {
      return false;
    }
    return threadMatchesAtoms(item, atomFilter, now);
  });
}
