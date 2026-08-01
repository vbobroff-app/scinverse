import { beforeEach, describe, expect, it } from 'vitest';
import { isThreadItem } from '@scinverse/notification-center';
import {
  hydrateServerBacklog,
  notificationBus,
  openBackendOutage,
  publishOperatorActionNeeded,
  resolveBackendOutage,
} from './notifications';
import type { NotificationDto } from './types';

describe('11.12 notifications Thread hints + hydrate', () => {
  beforeEach(() => {
    notificationBus.clear();
  });

  it('openBackendOutage stamps threadKindHint; resolve stamps closeOutcome', () => {
    openBackendOutage(1_720_000_000_000, 'ohs.backend.outage:1', 'incident', 3);
    const open = notificationBus.events[0]!;
    expect(open.code).toBe('backend.unavailable');
    expect(open.data?.threadKindHint).toBe('incident');
    expect(open.data?.connectionId).toBe(3);

    const dtos = resolveBackendOutage(1_720_000_000_000, 1_720_000_030_000, 'ohs.backend.outage:1');
    const close = dtos.find((d) => d.code === 'backend.recovered')!;
    expect(close.data).toMatchObject({ closeOutcome: 'recovered', connectionId: 3 });
    expect(dtos.find((d) => d.code === 'backend.unavailable')?.data).toMatchObject({
      threadKindHint: 'incident',
      connectionId: 3,
    });

    const thread = notificationBus.items.find(isThreadItem);
    expect(thread?.threadKind).toBe('incident');
    expect(thread?.threadStatus).toBe('resolved');
    expect(thread?.closeOutcome).toBe('recovered');
  });

  it('P4.1: openBackendOutage defaults to Incident (no Group-by-desired)', () => {
    openBackendOutage(1_720_000_000_000, 'ohs.backend.outage:g');
    expect(notificationBus.items.filter(isThreadItem)[0]?.threadKind).toBe('incident');
    expect(notificationBus.events[0]?.data).toMatchObject({ threadKindHint: 'incident' });
  });

  it('hydrateServerBacklog builds Thread from flat V025-shaped DTOs', () => {
    const corr = 'connection:1:link:abcd1234';
    const backlog: NotificationDto[] = [
      {
        id: 'a'.repeat(32),
        ts: '2026-07-14T10:00:00.000Z',
        severity: 'error',
        sourceType: 'system',
        module: 'ohs.connection',
        code: 'connection.lost',
        message: 'lost',
        status: 'active',
        correlationId: corr,
        data: { threadKindHint: 'incident', sender: 'transaq' },
        interaction: 'system',
        localization: 'internal',
      },
      {
        id: 'b'.repeat(32),
        ts: '2026-07-14T10:01:00.000Z',
        severity: 'ok',
        sourceType: 'system',
        module: 'ohs.connection',
        code: 'connection.recovered',
        message: 'up',
        status: 'resolved',
        correlationId: corr,
        data: { closeOutcome: 'recovered' },
        interaction: 'system',
        localization: 'internal',
      },
    ];

    hydrateServerBacklog(backlog);
    // повторная гидрация — дедуп по id
    hydrateServerBacklog(backlog);

    expect(notificationBus.events).toHaveLength(2);
    const thread = notificationBus.items.filter(isThreadItem);
    expect(thread).toHaveLength(1);
    expect(thread[0]!.threadKind).toBe('incident');
    expect(thread[0]!.threadStatus).toBe('resolved');
    expect(thread[0]!.closeOutcome).toBe('recovered');
  });

  it('publishOperatorActionNeeded is Single INFO without correlationId', () => {
    const dto = publishOperatorActionNeeded({
      connectionId: 3,
      label: 'Подключение 3 («Finam»)',
      reason: 'auto_exhausted',
      attempts: 5,
    });
    expect(dto.code).toBe('connection.operator_action_needed');
    expect(dto.severity).toBe('info');
    expect(dto.correlationId).toBeUndefined();
    expect(dto.message).toContain('Auto был остановлен после 5 попыток');
    expect(notificationBus.events.some((e) => e.code === 'connection.operator_action_needed')).toBe(
      true,
    );
    expect(notificationBus.items.filter(isThreadItem)).toHaveLength(0);
  });
});
