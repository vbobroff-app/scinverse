import { beforeEach, describe, expect, it } from 'vitest';
import { isSingleItem, isThreadItem } from '@scinverse/notification-center';
import {
  dismissLocalTransportDownSingle,
  hasLocalTransportDownSingle,
  hydrateServerBacklog,
  notificationBus,
  showLocalTransportDownSingle,
  tickLocalTransportDownSingle,
} from './notifications';
import type { NotificationDto } from './types';

describe('crash-dispatch D5: local transport Single', () => {
  beforeEach(() => {
    dismissLocalTransportDownSingle();
    notificationBus.clear();
  });

  it('show → FATAL Single without Thread; tick upserts same id', () => {
    const start = 1_720_000_000_000;
    showLocalTransportDownSingle(start);

    expect(hasLocalTransportDownSingle()).toBe(true);
    expect(notificationBus.items.filter(isThreadItem)).toHaveLength(0);
    const singles = notificationBus.items.filter(isSingleItem);
    expect(singles).toHaveLength(1);
    expect(singles[0]!.code).toBe('host.unreachable');
    expect(singles[0]!.severity).toBe('critical');
    expect(singles[0]!.message).toBe('Сервер OHS недоступен');
    expect(singles[0]!.correlationId).toBeUndefined();
    expect(singles[0]!.data?.local).toBe(true);

    const id = singles[0]!.id;
    tickLocalTransportDownSingle(start + 15_000);
    expect(notificationBus.events).toHaveLength(1);
    expect(notificationBus.events[0]!.id).toBe(id);
    expect(notificationBus.events[0]!.message).toContain('15 с');
    expect(notificationBus.items.filter(isThreadItem)).toHaveLength(0);
  });

  it('dismiss removes Single from bus', () => {
    showLocalTransportDownSingle(1_720_000_000_000);
    dismissLocalTransportDownSingle();
    expect(hasLocalTransportDownSingle()).toBe(false);
    expect(notificationBus.events).toHaveLength(0);
  });

  it('hydrate of C-layer crash Incident dismisses local Single', () => {
    showLocalTransportDownSingle(1_720_000_000_000);
    expect(hasLocalTransportDownSingle()).toBe(true);

    const backlog: NotificationDto[] = [
      {
        id: 'a'.repeat(32),
        ts: '2026-07-30T02:19:22.000Z',
        severity: 'critical',
        sourceType: 'system',
        module: 'ohs.host',
        code: 'backend.unavailable',
        message: 'Сервер OHS недоступен, жду восстановления',
        status: 'active',
        correlationId: 'ohs.backend.outage:1785375762000',
        data: {
          sender: 'client',
          kind: 'crash',
          connectionIds: [3],
          threadKindHint: 'incident',
        },
        interaction: 'system',
        localization: 'internal',
      },
    ];
    hydrateServerBacklog(backlog);

    expect(hasLocalTransportDownSingle()).toBe(false);
    expect(notificationBus.events.some((e) => e.data?.local === true)).toBe(false);
    const threads = notificationBus.items.filter(isThreadItem);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.uid).toBe('ohs.backend.outage:1785375762000');
    expect(threads[0]!.threadKind).toBe('incident');
  });
});
