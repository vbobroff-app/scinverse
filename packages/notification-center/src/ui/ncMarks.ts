import type { NcMarks } from '../types';

/** localStorage key: `nc.marks[uid]` → ★ / ⦸ (to-threads §5.3). */
export const NC_MARKS_STORAGE_KEY = 'nc.marks';

export type NcMarkMap = Record<string, NcMarks>;

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

export function toggleNcMark(
  marks: NcMarkMap,
  uid: string,
  key: 'isFavorite' | 'isLeft',
): NcMarkMap {
  const prev = marks[uid] ?? {};
  const nextVal = !prev[key];
  const next: NcMarks = { ...prev, [key]: nextVal || undefined };
  const copy = { ...marks };
  if (!next.isFavorite && !next.isLeft) {
    delete copy[uid];
  } else {
    copy[uid] = next;
  }
  return copy;
}
