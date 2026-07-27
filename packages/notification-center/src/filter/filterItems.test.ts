import { describe, expect, it } from 'vitest';
import { projectThreads } from '../bus/projectThreads';
import type { NotificationEvent } from '../types';
import { filterItems } from './filterItems';

function evt(
  partial: Partial<NotificationEvent> & Pick<NotificationEvent, 'id' | 'code'>,
): NotificationEvent {
  return {
    ts: '2026-07-14T12:00:00.000Z',
    severity: 'info',
    sourceType: 'system',
    module: 'test',
    message: 'msg',
    ...partial,
  };
}

describe('filterItems', () => {
  it('hides Singles when threadStatus filter is active', () => {
    const items = projectThreads([
      evt({ id: 's1', code: 'ping', message: 'solo' }),
      evt({
        id: 'o1',
        correlationId: 'c1',
        code: 'connection.lost',
        status: 'active',
        severity: 'error',
        message: 'down',
      }),
    ]);
    const visible = filterItems(items, { threadStatuses: ['active'] });
    expect(visible).toHaveLength(1);
    expect(visible[0]?.itemKind).toBe('thread');
  });

  it('filters Thread by threadStatus recovering', () => {
    const items = projectThreads([
      evt({
        id: 'r1',
        correlationId: 'c1',
        code: 'connection.recovering',
        status: 'underway',
        severity: 'warning',
        message: 'fixing',
      }),
      evt({
        id: 'o2',
        correlationId: 'c2',
        code: 'connection.lost',
        status: 'active',
        severity: 'error',
        message: 'down',
      }),
    ]);
    const visible = filterItems(items, { threadStatuses: ['recovering'] });
    expect(visible).toHaveLength(1);
    expect(visible[0]?.itemKind === 'thread' && visible[0].uid).toBe('c1');
  });

  it('choice filter keeps favorite containers', () => {
    const items = projectThreads([
      evt({ id: 's1', code: 'ping', message: 'solo' }),
      evt({ id: 's2', code: 'pong', message: 'other' }),
    ]).map((item, i) => (i === 0 ? { ...item, isFavorite: true } : item));
    const visible = filterItems(items, { choices: ['favorite'] });
    expect(visible).toHaveLength(1);
    expect(visible[0]?.itemKind === 'single' && visible[0].id).toBe('s1');
  });
});
