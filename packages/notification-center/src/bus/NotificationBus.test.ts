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

  describe('lifecycle status (ось B)', () => {
    it('keeps both rows on transition; statusOf follows the latest', () => {
      const bus = createNotificationBus();
      bus.publish(evt({ id: 'a1', correlationId: 'conn:1:link', code: 'connection.lost', status: 'active' }));
      bus.publish(evt({ id: 'a2', correlationId: 'conn:1:link', code: 'connection.recovered', status: 'resolved' }));
      expect(bus.events.map((e) => e.id)).toEqual(['a2', 'a1']);
      expect(bus.statusOf('conn:1:link')).toBe('resolved');
    });

    it('I2: dedups repeated same (status, code) within a correlationId', () => {
      const bus = createNotificationBus();
      bus.publish(evt({ id: 'a1', correlationId: 'c', code: 'x', status: 'active' }));
      bus.publish(evt({ id: 'a2', correlationId: 'c', code: 'x', status: 'active' }));
      bus.publish(evt({ id: 'a3', correlationId: 'c', code: 'x', status: 'underway' }));
      expect(bus.events.map((e) => e.id)).toEqual(['a3', 'a1']);
    });

    it('badge follows last status: resolved alert does not burn', () => {
      const bus = createNotificationBus();
      notify.error(bus, { module: 'm', code: 'connection.lost', message: 'down', id: 'e1', correlationId: 'conn:1:link', status: 'active' });
      expect(bus.unreadAlertCount).toBe(1);
      notify.info(bus, { module: 'm', code: 'connection.recovered', message: 'up', id: 'e2', correlationId: 'conn:1:link', status: 'resolved' });
      expect(bus.unreadAlertCount).toBe(0);
    });

    it('re-open (→ active) re-alerts via a fresh unread row', () => {
      const bus = createNotificationBus();
      notify.error(bus, { module: 'm', code: 'connection.lost', message: 'down', id: 'e1', correlationId: 'c', status: 'active' });
      bus.markAllRead();
      expect(bus.unreadAlertCount).toBe(0);
      notify.error(bus, { module: 'm', code: 'connection.lost', message: 'down again', id: 'e2', correlationId: 'c', status: 'active' });
      // Тот же статус того же кода — I2 дедуп: строка не добавляется, ре-алерта нет.
      expect(bus.unreadAlertCount).toBe(0);
      notify.info(bus, { module: 'm', code: 'connection.recovered', message: 'up', id: 'e3', correlationId: 'c', status: 'resolved' });
      notify.error(bus, { module: 'm', code: 'connection.lost', message: 'flap', id: 'e4', correlationId: 'c', status: 'active' });
      expect(bus.statusOf('c')).toBe('active');
      expect(bus.unreadAlertCount).toBe(1);
    });
  });
});
