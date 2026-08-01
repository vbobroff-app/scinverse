import { describe, expect, it } from 'vitest';
import type { NotificationEvent, ThreadItem } from '../types';
import {
  classifyEventLayer,
  classifyItemLayer,
  DEFAULT_LAYER_FILTER,
  layerFilterAllState,
  matchesLayerFilter,
  normalizeLayerFilter,
} from './layerFilter';

function evt(partial: Partial<NotificationEvent> & Pick<NotificationEvent, 'id' | 'code'>): NotificationEvent {
  return {
    ts: '2026-08-01T10:00:00.000Z',
    severity: 'error',
    sourceType: 'system',
    module: 'ohs.host',
    message: 'x',
    interaction: 'system',
    localization: 'internal',
    ...partial,
  };
}

describe('layerFilter', () => {
  it('default TL+CL, WL off', () => {
    expect(normalizeLayerFilter(undefined)).toEqual(DEFAULT_LAYER_FILTER);
    expect(normalizeLayerFilter({})).toEqual({ tl: true, cl: true, wl: false });
    expect(normalizeLayerFilter({ wl: true })).toEqual({ tl: true, cl: true, wl: true });
    expect(layerFilterAllState(DEFAULT_LAYER_FILTER)).toBe('mixed');
  });

  it('classifies crash as TL and break as CL', () => {
    expect(
      classifyEventLayer(
        evt({
          id: '1',
          code: 'backend.unavailable',
          correlationId: 'ohs.backend.outage:1',
          data: { kind: 'crash', connectionIds: [3] },
        }),
      ),
    ).toBe('tl');
    expect(
      classifyEventLayer(
        evt({
          id: '2',
          code: 'connection.lost',
          module: 'ohs.connection',
          correlationId: 'connection:3:link:abcd',
          data: { kind: 'break', connectionId: 3 },
        }),
      ),
    ).toBe('cl');
    expect(
      classifyEventLayer(
        evt({ id: '3', code: 'recording.started', module: 'ohs.recording' }),
      ),
    ).toBe('wl');
  });

  it('thread layer follows uid (crash Thread stays TL despite connectionIds)', () => {
    const open = evt({
      id: 'a',
      code: 'backend.unavailable',
      correlationId: 'ohs.backend.outage:99',
      data: { kind: 'crash', connectionIds: [1, 3] },
    });
    const thread: ThreadItem = {
      itemKind: 'thread',
      uid: 'ohs.backend.outage:99',
      subject: 'ohs.backend.outage',
      threadKind: 'incident',
      threadStatus: 'active',
      openedAt: open.ts,
      lastActivityAt: open.ts,
      header: { title: 'ohs.backend.outage' },
      notifications: [{ ...open, itemKind: 'entry', corrUid: 'ohs.backend.outage:99' }],
    };
    expect(classifyItemLayer(thread)).toBe('tl');
    expect(matchesLayerFilter(thread, { tl: true, cl: false, wl: false })).toBe(true);
    expect(matchesLayerFilter(thread, { tl: false, cl: true, wl: false })).toBe(false);
  });

  it('CL-only hides transport Single', () => {
    const single = {
      ...evt({ id: 's', code: 'host.unreachable', data: { local: true } }),
      itemKind: 'single' as const,
    };
    expect(matchesLayerFilter(single, { tl: false, cl: true, wl: false })).toBe(false);
    expect(matchesLayerFilter(single, DEFAULT_LAYER_FILTER)).toBe(true);
  });
});
