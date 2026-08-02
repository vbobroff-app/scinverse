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

  it('soft-deleted hidden by default; choice deleted includes them', () => {
    const items = projectThreads([
      evt({ id: 's1', code: 'ping', message: 'live' }),
      evt({
        id: 'a1',
        correlationId: 'c-del',
        code: 'connection.lost',
        status: 'active',
        message: 'lost',
      }),
      evt({
        id: 'a2',
        correlationId: 'c-del',
        code: 'connection.recovered',
        status: 'resolved',
        message: 'ok',
      }),
    ]).map((item) =>
      item.itemKind === 'thread' && item.uid === 'c-del'
        ? { ...item, isSoftDeleted: true }
        : item,
    );
    expect(filterItems(items, { choices: [] }).map((i) => (i.itemKind === 'thread' ? i.uid : i.id))).toEqual([
      's1',
    ]);
    const withDeleted = filterItems(items, { choices: ['deleted'] });
    expect(withDeleted).toHaveLength(2);
    expect(withDeleted.some((i) => i.itemKind === 'thread' && i.uid === 'c-del')).toBe(true);
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

  it('Коннекторы: TL crash with connectionIds is not cut by show/hide Id', () => {
    const items = projectThreads([
      evt({
        id: 'a',
        correlationId: 'ohs.backend.outage:42',
        code: 'backend.unavailable',
        data: { connectionIds: [1, 3], kind: 'crash', threadKindHint: 'incident' },
        message: 'down',
      }),
    ]);
    expect(
      filterItems(items, { connection: { showIdText: '2', hideIdText: '' } }),
    ).toHaveLength(1);
    expect(
      filterItems(items, { connection: { showIdText: '', hideIdText: '1' } }),
    ).toHaveLength(1);
  });

  it('Коннекторы: hide Id cuts CL only; TL stays', () => {
    const items = projectThreads([
      evt({
        id: 'a',
        correlationId: 'connection:1:link:aaaa',
        code: 'connection.lost',
        module: 'ohs.connection',
        data: { kind: 'break', connectionId: 1 },
        message: 'break1',
      }),
      evt({
        id: 'b',
        correlationId: 'connection:3:link:bbbb',
        code: 'connection.lost',
        module: 'ohs.connection',
        data: { kind: 'break', connectionId: 3 },
        message: 'break3',
      }),
      evt({
        id: 't',
        correlationId: 'ohs.host.transport:1',
        code: 'host.unreachable',
        message: 'no link',
      }),
    ]);
    const visible = filterItems(items, {
      connection: { showIdText: '', hideIdText: '1' },
    });
    expect(visible.map((i) => (i.itemKind === 'thread' ? i.uid : i.id))).toEqual([
      'connection:3:link:bbbb',
      'ohs.host.transport:1',
    ]);
  });

  it('Коннекторы: show Id keeps matching CL + all TL; hide wins over show', () => {
    const items = projectThreads([
      evt({
        id: 'a',
        correlationId: 'connection:1:link:aaaa',
        code: 'connection.lost',
        module: 'ohs.connection',
        data: { kind: 'break', connectionId: 1 },
        message: 'one',
      }),
      evt({
        id: 'b',
        correlationId: 'connection:3:link:bbbb',
        code: 'connection.lost',
        module: 'ohs.connection',
        data: { kind: 'break', connectionId: 3 },
        message: 'three',
      }),
      evt({ id: 'n', correlationId: 'c:none', code: 'host.unreachable', message: 'transport' }),
    ]);
    const showOnly = filterItems(items, {
      connection: { showIdText: '3', hideIdText: '' },
    });
    expect(showOnly.map((i) => (i.itemKind === 'thread' ? i.uid : i.id))).toEqual([
      'c:none',
      'connection:3:link:bbbb',
    ]);

    const both = filterItems(items, {
      connection: { showIdText: '3', hideIdText: '3' },
    });
    expect(both.map((i) => (i.itemKind === 'thread' ? i.uid : i.id))).toEqual(['c:none']);
  });

  it('layers: CL-only keeps break Thread, hides crash TL', () => {
    const items = projectThreads([
      evt({
        id: 'crash',
        correlationId: 'ohs.backend.outage:1',
        code: 'backend.unavailable',
        data: { kind: 'crash', connectionIds: [3] },
        message: 'outage',
      }),
      evt({
        id: 'break',
        correlationId: 'connection:3:link:abcd',
        code: 'connection.lost',
        module: 'ohs.connection',
        data: { kind: 'break', connectionId: 3 },
        message: 'link down',
      }),
    ]);
    const visible = filterItems(items, { layers: { tl: false, cl: true, wl: false } });
    expect(visible).toHaveLength(1);
    expect(visible[0]?.itemKind === 'thread' && visible[0].uid).toBe('connection:3:link:abcd');
  });
});
