import { describe, expect, it } from 'vitest';
import { createNotificationBus } from './NotificationBus';
import { isThreadItem, type NotificationEvent, type ThreadItem } from '../types';

/** Регрессия 11.12: сценарии break/crash (7j) → Incident/Group + hydrate V025. */

function evt(
  partial: Partial<NotificationEvent> & Pick<NotificationEvent, 'id' | 'code'>,
): NotificationEvent {
  return {
    ts: '2026-07-14T12:00:00.000Z',
    severity: 'info',
    sourceType: 'system',
    module: 'ohs.connection',
    message: 'msg',
    ...partial,
  };
}

function threads(bus: ReturnType<typeof createNotificationBus>): ThreadItem[] {
  return bus.items.filter(isThreadItem);
}

describe('11.12 Thread regression (7j break/crash)', () => {
  it('break lost→recovering→recovered → Incident resolved + closeOutcome', () => {
    const bus = createNotificationBus();
    const corr = 'connection:42:link:a1b2c3d4';
    bus.publishMany([
      evt({
        id: '1',
        correlationId: corr,
        code: 'connection.lost',
        status: 'active',
        severity: 'error',
        ts: '2026-07-14T10:00:00.000Z',
        data: { threadKindHint: 'incident', sender: 'transaq' },
        message: 'связь потеряна',
      }),
      evt({
        id: '2',
        correlationId: corr,
        code: 'connection.recovering',
        status: 'underway',
        severity: 'warning',
        ts: '2026-07-14T10:00:05.000Z',
        message: 'восстановление · 5 с',
      }),
      evt({
        id: '3',
        correlationId: corr,
        code: 'connection.recovered',
        status: 'resolved',
        severity: 'ok',
        ts: '2026-07-14T10:01:00.000Z',
        data: { closeOutcome: 'recovered', sender: 'transaq' },
        message: 'связь восстановлена',
      }),
    ]);

    const list = threads(bus);
    expect(list).toHaveLength(1);
    expect(list[0]!.threadKind).toBe('incident');
    expect(list[0]!.threadStatus).toBe('resolved');
    expect(list[0]!.closeOutcome).toBe('recovered');
    expect(list[0]!.notifications.map((e) => e.code)).toEqual([
      'connection.lost',
      'connection.recovering',
      'connection.recovered',
    ]);
    // плоский audit не сломан
    expect(bus.events.map((e) => e.id)).toEqual(['3', '2', '1']);
  });

  it('break abandoned_schedule → Incident resolved without recovered', () => {
    const bus = createNotificationBus();
    const corr = 'connection:7:link:deadbeef';
    bus.publishMany([
      evt({
        id: 'o',
        correlationId: corr,
        code: 'connection.lost',
        status: 'active',
        severity: 'error',
        ts: '2026-07-14T18:00:00.000Z',
        data: { threadKindHint: 'incident' },
      }),
      evt({
        id: 'c',
        correlationId: corr,
        code: 'connection.incident_closed',
        status: 'resolved',
        severity: 'warning',
        ts: '2026-07-14T23:50:00.000Z',
        data: {
          kind: 'break',
          reason: 'schedule_end',
          closeOutcome: 'abandoned_schedule',
        },
      }),
    ]);

    const t = threads(bus)[0]!;
    expect(t.threadKind).toBe('incident');
    expect(t.threadStatus).toBe('resolved');
    expect(t.closeOutcome).toBe('abandoned_schedule');
  });

  it('crash unavailable→recovering→recovered → Incident (kind=crash)', () => {
    const bus = createNotificationBus();
    const corr = 'ohs.backend.outage:1720000000000';
    bus.publishMany([
      evt({
        id: 'f',
        correlationId: corr,
        code: 'backend.unavailable',
        status: 'active',
        severity: 'critical',
        module: 'ohs.host',
        ts: '2026-07-14T12:00:00.000Z',
        data: { sender: 'client', kind: 'crash', threadKindHint: 'incident' },
      }),
      evt({
        id: 'w',
        correlationId: corr,
        code: 'backend.recovering',
        status: 'underway',
        severity: 'warning',
        module: 'ohs.host',
        ts: '2026-07-14T12:00:20.000Z',
      }),
      evt({
        id: 'ok',
        correlationId: corr,
        code: 'backend.recovered',
        status: 'resolved',
        severity: 'ok',
        module: 'ohs.host',
        ts: '2026-07-14T12:00:30.000Z',
        data: { closeOutcome: 'recovered', sender: 'client' },
      }),
    ]);

    const t = threads(bus)[0]!;
    expect(t.threadKind).toBe('incident');
    expect(t.threadStatus).toBe('resolved');
    expect(t.closeOutcome).toBe('recovered');
    expect(t.notifications[0]?.data?.kind).toBe('crash');
  });

  it('Group outside horizon does not continue as Incident (new corr)', () => {
    const bus = createNotificationBus();
    const groupCorr = 'ohs.backend.outage:group1';
    const incidentCorr = 'ohs.backend.outage:incident2';

    // Вне горизонта — Group, остаётся open.
    bus.publish(
      evt({
        id: 'g-open',
        correlationId: groupCorr,
        code: 'backend.unavailable',
        status: 'active',
        severity: 'critical',
        ts: '2026-07-14T03:00:00.000Z',
        data: { kind: 'crash', threadKindHint: 'group' },
      }),
    );
    // Новый сбой в окне — новый corr → Incident (не продолжение Group).
    bus.publish(
      evt({
        id: 'i-open',
        correlationId: incidentCorr,
        code: 'backend.unavailable',
        status: 'active',
        severity: 'critical',
        ts: '2026-07-14T10:00:00.000Z',
        data: { kind: 'crash', threadKindHint: 'incident' },
      }),
    );

    const list = threads(bus);
    expect(list).toHaveLength(2);
    const group = list.find((t) => t.uid === groupCorr)!;
    const incident = list.find((t) => t.uid === incidentCorr)!;
    expect(group.threadKind).toBe('group');
    expect(group.threadStatus).toBe('active');
    expect(incident.threadKind).toBe('incident');
    expect(incident.threadStatus).toBe('active');
    expect(group.uid).not.toBe(incident.uid);
  });

  it('hydrate (publishMany backlog) matches live projection; I2 upsert intact', () => {
    const corr = 'connection:9:link:hydrate01';
    const backlog: NotificationEvent[] = [
      // oldest-first как GET /api/notifications
      evt({
        id: 'h1',
        correlationId: corr,
        code: 'connection.lost',
        status: 'active',
        severity: 'error',
        ts: '2026-07-14T12:00:00.000Z',
        data: { threadKindHint: 'incident' },
        message: 'Degraded',
      }),
      evt({
        id: 'h2',
        correlationId: corr,
        code: 'connection.lost',
        status: 'active',
        severity: 'error',
        ts: '2026-07-14T12:00:10.000Z',
        data: { threadKindHint: 'incident' },
        message: 'Down',
      }),
      evt({
        id: 'h3',
        correlationId: corr,
        code: 'connection.recovering',
        status: 'underway',
        severity: 'warning',
        ts: '2026-07-14T12:00:15.000Z',
        message: '4 c',
      }),
      evt({
        id: 'h4',
        correlationId: corr,
        code: 'connection.recovered',
        status: 'resolved',
        severity: 'ok',
        ts: '2026-07-14T12:01:00.000Z',
        data: { closeOutcome: 'recovered' },
      }),
    ];

    const hydrated = createNotificationBus();
    hydrated.publishMany(backlog);

    const live = createNotificationBus();
    // live: те же атомы по одному + I2-тик recovering до close
    for (const e of backlog.slice(0, 3)) {
      live.publish(e);
    }
    live.publish(
      evt({
        id: 'tick',
        correlationId: corr,
        code: 'connection.recovering',
        status: 'underway',
        severity: 'warning',
        ts: '2026-07-14T12:00:20.000Z',
        message: '19 c',
      }),
    );
    live.publish(backlog[3]!);

    expect(hydrated.items).toHaveLength(1);
    expect(live.items).toHaveLength(1);
    const ht = threads(hydrated)[0]!;
    const lt = threads(live)[0]!;
    expect(ht.threadKind).toBe(lt.threadKind);
    expect(ht.threadStatus).toBe('resolved');
    expect(lt.threadStatus).toBe('resolved');
    // discrete lost ×2 сохранены; I2 оставил одну recovering-строку (текст с тика)
    expect(ht.notifications.filter((e) => e.code === 'connection.lost')).toHaveLength(2);
    expect(lt.notifications.filter((e) => e.code === 'connection.recovering')).toHaveLength(1);
    expect(lt.notifications.find((e) => e.code === 'connection.recovering')?.message).toBe('19 c');
    expect(busEventsHaveUniqueIds(hydrated.events)).toBe(true);
  });
});

function busEventsHaveUniqueIds(events: readonly NotificationEvent[]): boolean {
  const ids = events.map((e) => e.id);
  return new Set(ids).size === ids.length;
}
