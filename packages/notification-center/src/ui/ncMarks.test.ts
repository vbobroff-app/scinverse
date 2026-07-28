import { describe, expect, it } from 'vitest';
import type { ThreadItem } from '../types';
import {
  resolveEntryMarks,
  resolveThreadHeaderMarks,
  setThreadBulkMarks,
  toggleNcMark,
} from './ncMarks';

function thread(partial: Partial<ThreadItem> & Pick<ThreadItem, 'uid' | 'notifications'>): ThreadItem {
  return {
    itemKind: 'thread',
    threadKind: 'group',
    threadStatus: 'active',
    openedAt: '2026-07-14T12:00:00.000Z',
    lastActivityAt: '2026-07-14T12:00:00.000Z',
    header: { title: 't' },
    ...partial,
  };
}

describe('ncMarks', () => {
  it('resolveEntryMarks falls back to legacy thread.uid', () => {
    const marks = { c1: { isFavorite: true } };
    expect(resolveEntryMarks(marks, 'e1', 'c1').isFavorite).toBe(true);
    expect(resolveEntryMarks(marks, 'e1').isFavorite).toBeUndefined();
  });

  it('header ★ = any, header ⊘ = all', () => {
    const t = thread({
      uid: 'c1',
      notifications: [
        {
          id: 'e1',
          ts: '2026-07-14T12:00:00.000Z',
          severity: 'info',
          sourceType: 'system',
          module: 'm',
          code: 'a',
          message: '1',
        },
        {
          id: 'e2',
          ts: '2026-07-14T12:01:00.000Z',
          severity: 'info',
          sourceType: 'system',
          module: 'm',
          code: 'b',
          message: '2',
        },
      ],
    });
    expect(resolveThreadHeaderMarks({ e1: { isFavorite: true } }, t)).toEqual({
      isFavorite: true,
      isLeft: undefined,
    });
    expect(resolveThreadHeaderMarks({ e1: { isLeft: true }, e2: { isLeft: true } }, t)).toEqual({
      isFavorite: undefined,
      isLeft: true,
    });
    expect(resolveThreadHeaderMarks({ e1: { isLeft: true } }, t).isLeft).toBeUndefined();
  });

  it('setThreadBulkMarks toggles all entries and clears legacy uid', () => {
    const t = thread({
      uid: 'c1',
      notifications: [
        {
          id: 'e1',
          ts: '2026-07-14T12:00:00.000Z',
          severity: 'info',
          sourceType: 'system',
          module: 'm',
          code: 'a',
          message: '1',
        },
        {
          id: 'e2',
          ts: '2026-07-14T12:01:00.000Z',
          severity: 'info',
          sourceType: 'system',
          module: 'm',
          code: 'b',
          message: '2',
        },
      ],
    });
    let marks = { c1: { isFavorite: true as const } };
    marks = setThreadBulkMarks(marks, t, 'isFavorite', true);
    expect(marks.e1?.isFavorite).toBe(true);
    expect(marks.e2?.isFavorite).toBe(true);
    expect(marks.c1).toBeUndefined();
    marks = setThreadBulkMarks(marks, t, 'isFavorite', false);
    expect(marks.e1).toBeUndefined();
    expect(marks.e2).toBeUndefined();
  });

  it('toggleNcMark removes empty record', () => {
    let marks = toggleNcMark({}, 'x', 'isLeft');
    expect(marks.x?.isLeft).toBe(true);
    marks = toggleNcMark(marks, 'x', 'isLeft');
    expect(marks.x).toBeUndefined();
  });
});
