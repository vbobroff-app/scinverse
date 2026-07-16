import { describe, expect, it } from 'vitest';
import { createNotificationBus } from './NotificationBus';
import { notify } from './notify';
import type { NotificationEvent } from '../types';

function evt(partial: Partial<NotificationEvent> & Pick<NotificationEvent, 'id'>): NotificationEvent {
  return {
    ts: '2026-07-14T12:00:00.000Z',
    severity: 'info',
    sourceType: 'system',
    module: 'test',
    code: 'test.code',
    message: 'msg',
    ...partial,
  };
}

describe('NotificationBus', () => {
  it('publishes and dedups by id', () => {
    const bus = createNotificationBus({ limit: 10 });
    bus.publish(evt({ id: 'a', message: 'one' }));
    bus.publish(evt({ id: 'a', message: 'dup' }));
    bus.publish(evt({ id: 'b', message: 'two' }));
    expect(bus.events.map((e) => e.id)).toEqual(['b', 'a']);
    expect(bus.events[1]?.message).toBe('one');
  });

  it('respects ring-buffer limit', () => {
    const bus = createNotificationBus({ limit: 3 });
    bus.publishMany([
      evt({ id: '1' }),
      evt({ id: '2' }),
      evt({ id: '3' }),
      evt({ id: '4' }),
    ]);
    expect(bus.events.map((e) => e.id)).toEqual(['1', '2', '3']);
  });

  it('counts unread error/critical only', () => {
    const bus = createNotificationBus();
    notify.info(bus, { module: 'm', code: 'i', message: 'ok' });
    notify.error(bus, { module: 'm', code: 'e', message: 'fail', id: 'err1' });
    notify.critical(bus, { module: 'm', code: 'c', message: 'boom', id: 'crit1' });
    expect(bus.unreadAlertCount).toBe(2);
    bus.markRead('err1');
    expect(bus.unreadAlertCount).toBe(1);
    bus.markAllRead();
    expect(bus.unreadAlertCount).toBe(0);
  });

  it('counts unread warnings separately', () => {
    const bus = createNotificationBus();
    notify.warn(bus, { module: 'm', code: 'w1', message: 'a', id: 'w1' });
    notify.warn(bus, { module: 'm', code: 'w2', message: 'b', id: 'w2' });
    notify.error(bus, { module: 'm', code: 'e', message: 'e', id: 'e1' });
    expect(bus.unreadWarningCount).toBe(2);
    expect(bus.unreadAlertCount).toBe(1);
    bus.markRead('w1');
    expect(bus.unreadWarningCount).toBe(1);
    bus.markAllRead();
    expect(bus.unreadWarningCount).toBe(0);
  });

  it('clear empties the feed', () => {
    const bus = createNotificationBus();
    notify.warn(bus, { module: 'm', code: 'w', message: 'warn' });
    bus.clear();
    expect(bus.events).toEqual([]);
    expect(bus.unreadAlertCount).toBe(0);
  });
});
