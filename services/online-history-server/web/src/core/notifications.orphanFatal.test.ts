import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeRecentOrphanUnhandledWithHealthOk,
  collectRecentOrphanUnhandledCorrs,
  healthCheckOk,
  notificationBus,
  publishServerNotification,
} from './notifications';
import type { NotificationDto } from './types';

let nextId = 0;
function unhandled(corr: string, tsMs: number): NotificationDto {
  nextId += 1;
  return {
    id: nextId.toString(16).padStart(32, '0'),
    ts: new Date(tsMs).toISOString(),
    severity: 'critical',
    sourceType: 'system',
    module: 'ohs.host',
    code: 'ohs.unhandled',
    message: 'Внутренняя ошибка сервера: необработанное исключение (500)',
    status: 'active',
    correlationId: corr,
    interaction: 'system',
    localization: 'internal',
    data: { sender: 'backend' },
  };
}

describe('I12: orphan ohs.unhandled + health-ok batch', () => {
  beforeEach(() => {
    nextId = 0;
    notificationBus.clear();
  });

  it('collectRecentOrphanUnhandledCorrs returns all recent unresolved fatals', () => {
    const now = 1_720_000_000_000;
    publishServerNotification(unhandled('req-a', now - 1_000));
    publishServerNotification(unhandled('req-b', now - 2_000));
    publishServerNotification(unhandled('req-c', now - 3_000));

    expect(collectRecentOrphanUnhandledCorrs({ withinMs: 15_000, nowMs: now }).sort()).toEqual([
      'req-a',
      'req-b',
      'req-c',
    ]);
  });

  it('collect skips already resolved and stale corrs', () => {
    const now = 1_720_000_000_000;
    publishServerNotification(unhandled('req-old', now - 60_000));
    publishServerNotification(unhandled('req-live', now - 500));
    healthCheckOk('req-live');

    expect(collectRecentOrphanUnhandledCorrs({ withinMs: 15_000, nowMs: now })).toEqual([]);
  });

  it('closeRecentOrphanUnhandledWithHealthOk resolves every orphan corr', () => {
    const now = 1_720_000_000_000;
    publishServerNotification(unhandled('req-1', now - 100));
    publishServerNotification(unhandled('req-2', now - 200));
    publishServerNotification(unhandled('req-3', now - 300));

    const okDtos = closeRecentOrphanUnhandledWithHealthOk({ withinMs: 15_000, nowMs: now });
    expect(okDtos.map((d) => d.correlationId).sort()).toEqual(['req-1', 'req-2', 'req-3']);
    expect(notificationBus.statusOf('req-1')).toBe('resolved');
    expect(notificationBus.statusOf('req-2')).toBe('resolved');
    expect(notificationBus.statusOf('req-3')).toBe('resolved');
    expect(collectRecentOrphanUnhandledCorrs({ withinMs: 15_000, nowMs: now })).toEqual([]);
  });
});
