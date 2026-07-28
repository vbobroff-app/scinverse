import type { NcMarks, ThreadItem } from '../types';

/** localStorage key: `nc.marks[uid]` → ★ / ⊘ (id события или legacy thread.uid). */
export const NC_MARKS_STORAGE_KEY = 'nc.marks';

export type NcMarkMap = Record<string, NcMarks>;
export type NcMarkKey = 'isFavorite' | 'isLeft';

export function loadNcMarks(): NcMarkMap {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  try {
    const raw = localStorage.getItem(NC_MARKS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const out: NcMarkMap = {};
    for (const [uid, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') {
        continue;
      }
      const v = value as NcMarks;
      out[uid] = {
        isFavorite: Boolean(v.isFavorite) || undefined,
        isLeft: Boolean(v.isLeft) || undefined,
      };
      if (!out[uid].isFavorite && !out[uid].isLeft) {
        delete out[uid];
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveNcMarks(marks: NcMarkMap): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(NC_MARKS_STORAGE_KEY, JSON.stringify(marks));
  } catch {
    /* ignore quota */
  }
}

/** Маркер Entry: своё значение, иначе legacy-метка на thread.uid (старые данные). */
export function resolveEntryMarks(
  marks: NcMarkMap,
  entryId: string,
  threadUid?: string,
): NcMarks {
  const own = marks[entryId];
  const legacy = threadUid ? marks[threadUid] : undefined;
  return {
    isFavorite: Boolean(own?.isFavorite || legacy?.isFavorite) || undefined,
    isLeft: Boolean(own?.isLeft || legacy?.isLeft) || undefined,
  };
}

/** Header ★ = any; header ⊘ = all (пустой стек → оба false). */
export function resolveThreadHeaderMarks(
  marks: NcMarkMap,
  thread: Pick<ThreadItem, 'uid' | 'notifications'>,
): NcMarks {
  const entries = thread.notifications;
  if (entries.length === 0) {
    return {};
  }
  let anyFav = false;
  let allSpam = true;
  for (const e of entries) {
    const m = resolveEntryMarks(marks, e.id, thread.uid);
    if (m.isFavorite) {
      anyFav = true;
    }
    if (!m.isLeft) {
      allSpam = false;
    }
  }
  return {
    isFavorite: anyFav || undefined,
    isLeft: allSpam || undefined,
  };
}

function writeMark(marks: NcMarkMap, uid: string, key: NcMarkKey, value: boolean): NcMarkMap {
  const prev = marks[uid] ?? {};
  const next: NcMarks = { ...prev, [key]: value || undefined };
  const copy = { ...marks };
  if (!next.isFavorite && !next.isLeft) {
    delete copy[uid];
  } else {
    copy[uid] = next;
  }
  return copy;
}

export function toggleNcMark(marks: NcMarkMap, uid: string, key: NcMarkKey): NcMarkMap {
  const prev = marks[uid] ?? {};
  return writeMark(marks, uid, key, !prev[key]);
}

/** Выставить маркер на набор id (bulk header). */
export function setNcMarksForIds(
  marks: NcMarkMap,
  ids: readonly string[],
  key: NcMarkKey,
  value: boolean,
): NcMarkMap {
  let next = marks;
  for (const id of ids) {
    next = writeMark(next, id, key, value);
  }
  return next;
}

/**
 * Bulk header: все Entry on/off + сброс legacy-метки на `thread.uid`
 * (иначе resolveEntryMarks продолжит тянуть старый thread-level mark).
 */
export function setThreadBulkMarks(
  marks: NcMarkMap,
  thread: Pick<ThreadItem, 'uid' | 'notifications'>,
  key: NcMarkKey,
  value: boolean,
): NcMarkMap {
  const ids = thread.notifications.map((e) => e.id);
  let next = setNcMarksForIds(marks, ids, key, value);
  next = writeMark(next, thread.uid, key, false);
  return next;
}
