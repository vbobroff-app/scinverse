import {
  readCloseOutcome,
  readThreadKindHint,
  resolveStatus,
} from '../types';
import type {
  CloseOutcome,
  EntryItem,
  NotificationEvent,
  NotificationItem,
  SingleItem,
  ThreadHeader,
  ThreadItem,
  ThreadKind,
  ThreadStatus,
} from '../types';

/** Коды open, для которых без hint считаем Incident (link/crash whitelist). */
const INCIDENT_OPEN_CODES = new Set([
  'connection.lost',
  'backend.unavailable',
  'connection.auto_error',
  // connect_failed — не open break: либо Append в link-corr, либо terminal Group connect:
]);

const RECOVERING_CODES = new Set([
  'connection.recovering',
  'backend.recovering',
  'connection.reconnecting',
]);

const TERMINAL_CLOSE_CODES = new Set([
  'connection.recovered',
  'backend.recovered',
  'connection.incident_closed',
]);

/**
 * Проекция плоского audit → лента контейнеров Single | Thread.
 * Spec: docs/dev/phase11/to-threads.md §5.2.
 *
 * - без correlationId → Single;
 * - с corr → один Thread (Entry[] по ts asc);
 * - orphan recovering без open — Thread из имеющихся Entry, без фейкового open;
 * - sortKey ленты = lastActivityAt (newest-first).
 */
export function projectThreads(events: readonly NotificationEvent[]): NotificationItem[] {
  const singles: SingleItem[] = [];
  const byCorr = new Map<string, NotificationEvent[]>();

  for (const e of events) {
    if (!e.correlationId) {
      singles.push(toSingle(e));
      continue;
    }
    const list = byCorr.get(e.correlationId);
    if (list) {
      list.push(e);
    } else {
      byCorr.set(e.correlationId, [e]);
    }
  }

  const threads: ThreadItem[] = [];
  for (const [corrUid, group] of byCorr) {
    threads.push(buildThread(corrUid, group));
  }

  return sortItemsByLastActivity([...singles, ...threads]);
}

function toSingle(e: NotificationEvent): SingleItem {
  return { ...e, itemKind: 'single' };
}

function toEntry(e: NotificationEvent, corrUid: string): EntryItem {
  return { ...e, itemKind: 'entry', corrUid };
}

function buildThread(corrUid: string, group: readonly NotificationEvent[]): ThreadItem {
  const ordered = sortOldestFirst(group);
  const notifications = ordered.map((e) => toEntry(e, corrUid));
  const openedAt = ordered[0]?.ts ?? '';
  const lastActivityAt = maxTs(ordered);
  const threadStatus = deriveThreadStatus(ordered);
  const terminal = findTerminalClose(ordered);
  const closeOutcome =
    threadStatus === 'resolved' ? deriveCloseOutcome(terminal, ordered) : undefined;
  const threadKind = deriveThreadKind(ordered);
  const subject = deriveSubject(corrUid);
  const closedAt = terminal?.ts;

  const thread: ThreadItem = {
    itemKind: 'thread',
    uid: corrUid,
    notifications,
    threadKind,
    threadStatus,
    openedAt,
    closedAt,
    lastActivityAt,
    subject,
    closeOutcome,
    header: buildHeader(subject ?? corrUid, threadKind, threadStatus, closeOutcome),
  };
  return thread;
}

function deriveThreadStatus(oldestFirst: readonly NotificationEvent[]): ThreadStatus {
  if (oldestFirst.some(isTerminalClose)) {
    return 'resolved';
  }
  // Последний «ведущий» lifecycle с конца ленты нити.
  for (let i = oldestFirst.length - 1; i >= 0; i -= 1) {
    const e = oldestFirst[i]!;
    if (isRecoveringEntry(e)) {
      return 'recovering';
    }
    if (isOpenLikeEntry(e)) {
      return 'active';
    }
  }
  return 'active';
}

function isTerminalClose(e: NotificationEvent): boolean {
  if (resolveStatus(e) === 'resolved') {
    return true;
  }
  return TERMINAL_CLOSE_CODES.has(e.code);
}

function isRecoveringEntry(e: NotificationEvent): boolean {
  if (RECOVERING_CODES.has(e.code)) {
    return true;
  }
  return resolveStatus(e) === 'underway' && e.code.includes('recovering');
}

function isOpenLikeEntry(e: NotificationEvent): boolean {
  if (INCIDENT_OPEN_CODES.has(e.code)) {
    return true;
  }
  return resolveStatus(e) === 'active';
}

function findTerminalClose(
  oldestFirst: readonly NotificationEvent[],
): NotificationEvent | undefined {
  for (let i = oldestFirst.length - 1; i >= 0; i -= 1) {
    const e = oldestFirst[i]!;
    if (isTerminalClose(e)) {
      return e;
    }
  }
  return undefined;
}

function deriveCloseOutcome(
  terminal: NotificationEvent | undefined,
  oldestFirst: readonly NotificationEvent[],
): CloseOutcome | undefined {
  if (terminal) {
    const fromData = readCloseOutcome(terminal.data);
    if (fromData) {
      return fromData;
    }
    if (terminal.code === 'connection.recovered' || terminal.code === 'backend.recovered') {
      return 'recovered';
    }
    if (terminal.code === 'connection.incident_closed') {
      const reason = terminal.data?.reason;
      if (
        reason === 'manual_off' ||
        reason === 'manual' ||
        reason === 'abandoned_manual'
      ) {
        return 'abandoned_manual';
      }
      return 'abandoned_schedule';
    }
  }
  // Fallback: любой Entry с closeOutcome в data.
  for (let i = oldestFirst.length - 1; i >= 0; i -= 1) {
    const fromData = readCloseOutcome(oldestFirst[i]?.data);
    if (fromData) {
      return fromData;
    }
  }
  return undefined;
}

/**
 * threadKind: hint с Open (или любого Entry) → иначе whitelist open-кодов / crash → incident;
 * иначе group (безопаснее, чем раздувать журнал инцидентов).
 */
function deriveThreadKind(oldestFirst: readonly NotificationEvent[]): ThreadKind {
  for (const e of oldestFirst) {
    const hint = readThreadKindHint(e.data);
    if (hint) {
      return hint;
    }
  }
  for (const e of oldestFirst) {
    if (INCIDENT_OPEN_CODES.has(e.code)) {
      return 'incident';
    }
    if (e.data?.kind === 'crash') {
      return 'incident';
    }
  }
  return 'group';
}

/** Префикс corr для заголовка: `connection:{id}:link` → `connection:{id}`. */
export function deriveSubject(corrUid: string): string | undefined {
  const conn = /^connection:([^:]+):/.exec(corrUid);
  if (conn) {
    return `connection:${conn[1]}`;
  }
  const outage = /^(ohs\.backend\.outage)(?::|$)/.exec(corrUid);
  if (outage) {
    return outage[1];
  }
  const idx = corrUid.lastIndexOf(':');
  if (idx > 0) {
    return corrUid.slice(0, idx);
  }
  return undefined;
}

function buildHeader(
  title: string,
  threadKind: ThreadKind,
  threadStatus: ThreadStatus,
  closeOutcome: CloseOutcome | undefined,
): ThreadHeader {
  const kindLabel = threadKind === 'incident' ? 'Incident' : 'Group';
  const outcome = closeOutcome ? ` · ${closeOutcome}` : '';
  return {
    title,
    summary: `${kindLabel} · ${threadStatus}${outcome}`,
  };
}

function sortOldestFirst(events: readonly NotificationEvent[]): NotificationEvent[] {
  return events
    .map((e, index) => ({ e, index, ms: Date.parse(e.ts) }))
    .sort((a, b) => {
      const ta = Number.isFinite(a.ms) ? a.ms : 0;
      const tb = Number.isFinite(b.ms) ? b.ms : 0;
      if (ta !== tb) {
        return ta - tb;
      }
      if (a.e.id !== b.e.id) {
        return a.e.id < b.e.id ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map(({ e }) => e);
}

function maxTs(events: readonly NotificationEvent[]): string {
  let best = '';
  let bestMs = -Infinity;
  for (const e of events) {
    const ms = Date.parse(e.ts);
    const n = Number.isFinite(ms) ? ms : 0;
    if (n >= bestMs) {
      bestMs = n;
      best = e.ts;
    }
  }
  return best;
}

function itemSortKey(item: NotificationItem): { ms: number; id: string } {
  if (item.itemKind === 'thread') {
    return { ms: Date.parse(item.lastActivityAt), id: item.uid };
  }
  return { ms: Date.parse(item.ts), id: item.id };
}

function sortItemsByLastActivity(items: readonly NotificationItem[]): NotificationItem[] {
  return items
    .map((item, index) => {
      const key = itemSortKey(item);
      return {
        item,
        index,
        ms: Number.isFinite(key.ms) ? key.ms : 0,
        id: key.id,
      };
    })
    .sort((a, b) => {
      if (b.ms !== a.ms) {
        return b.ms - a.ms;
      }
      if (a.id !== b.id) {
        return a.id < b.id ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
