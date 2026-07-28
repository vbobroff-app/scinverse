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

  it('choice ★ keeps only favorites', () => {
    const items = projectThreads([
      evt({ id: 's1', code: 'ping', message: 'solo' }),
      evt({ id: 's2', code: 'pong', message: 'other' }),
    ]).map((item, i) => (i === 0 ? { ...item, isFavorite: true } : item));
    const visible = filterItems(items, { choices: ['favorite'] });
    expect(visible).toHaveLength(1);
    expect(visible[0]?.itemKind === 'single' && visible[0].id).toBe('s1');
  });

  it('choice ⊘ excludes spam containers', () => {
    const items = projectThreads([
      evt({ id: 's1', code: 'ping', message: 'solo' }),
      evt({ id: 's2', code: 'pong', message: 'spam' }),
    ]).map((item, i) => (i === 1 ? { ...item, isLeft: true } : item));
    const visible = filterItems(items, { choices: ['left'] });
    expect(visible).toHaveLength(1);
    expect(visible[0]?.itemKind === 'single' && visible[0].id).toBe('s1');
  });

  it('choice ★+⊘: spam wins over favorite', () => {
    const items = projectThreads([
      evt({ id: 'fav', code: 'ping', message: 'keep' }),
      evt({ id: 'both', code: 'pong', message: 'dual' }),
      evt({ id: 'spam', code: 'zap', message: 'hide' }),
    ]).map((item) => {
      if (item.itemKind !== 'single') {
        return item;
      }
      if (item.id === 'fav') {
        return { ...item, isFavorite: true };
      }
      if (item.id === 'both') {
        return { ...item, isFavorite: true, isLeft: true };
      }
      if (item.id === 'spam') {
        return { ...item, isLeft: true };
      }
      return item;
    });
    const visible = filterItems(items, { choices: ['favorite', 'left'] });
    expect(visible).toHaveLength(1);
    expect(visible[0]?.itemKind === 'single' && visible[0].id).toBe('fav');
  });

  it('choice ★ keeps Thread when header favorite (any)', () => {
    const items = projectThreads([
      evt({
        id: 'o1',
        correlationId: 'c1',
        code: 'connection.lost',
        status: 'active',
        severity: 'error',
        message: 'down',
      }),
      evt({ id: 's1', code: 'ping', message: 'solo' }),
    ]).map((item) =>
      item.itemKind === 'thread' && item.uid === 'c1' ? { ...item, isFavorite: true } : item,
    );
    const visible = filterItems(items, { choices: ['favorite'] });
    expect(visible).toHaveLength(1);
    expect(visible[0]?.itemKind === 'thread' && visible[0].uid).toBe('c1');
  });
});
