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
    // Повтор того же id — замена полей (adopt 500 / re-POST).
    expect(bus.events[1]?.message).toBe('dup');
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

  it('remove drops a single event by id', () => {
    const bus = createNotificationBus();
    notify.error(bus, { id: 'e1', module: 'm', code: 'c', message: 'a' });
    notify.info(bus, { id: 'i1', module: 'm', code: 'c', message: 'b' });
    expect(bus.remove('e1')).toBe(true);
    expect(bus.events.map((e) => e.id)).toEqual(['i1']);
    expect(bus.remove('missing')).toBe(false);
  });

  describe('lifecycle status (ось B)', () => {
    it('keeps both rows on transition; statusOf follows the latest', () => {
      const bus = createNotificationBus();
      bus.publish(evt({ id: 'a1', correlationId: 'conn:1:link', code: 'connection.lost', status: 'active' }));
      bus.publish(evt({ id: 'a2', correlationId: 'conn:1:link', code: 'connection.recovered', status: 'resolved' }));
      expect(bus.events.map((e) => e.id)).toEqual(['a2', 'a1']);
      expect(bus.statusOf('conn:1:link')).toBe('resolved');
    });

    it('non-tick codes are not I2-collapsed (each delivery keeps a row)', () => {
      const bus = createNotificationBus();
      bus.publish(evt({ id: 'a1', correlationId: 'c', code: 'connection.connect', status: 'underway' }));
      bus.publish(evt({ id: 'a2', correlationId: 'c', code: 'connection.connect', status: 'underway' }));
      bus.publish(evt({ id: 'a3', correlationId: 'c', code: 'connection.lost', status: 'active' }));
      expect(bus.events.map((e) => e.id)).toEqual(['a3', 'a2', 'a1']);
    });

    it('I2: connect_failed ticks collapse in place (same as reconnecting)', () => {
      const bus = createNotificationBus();
      const corr = 'connection:3:link:abcd';
      bus.publish(
        evt({
          id: 'f1',
          correlationId: corr,
          code: 'connection.connect_failed',
          severity: 'error',
          status: 'underway',
          message: 'попытка 1/5',
        }),
      );
      bus.publish(
        evt({
          id: 'f2',
          correlationId: corr,
          code: 'connection.connect_failed',
          severity: 'error',
          status: 'underway',
          message: 'попытка 2/5',
        }),
      );
      bus.publish(
        evt({
          id: 'f3',
          correlationId: corr,
          code: 'connection.connect_failed',
          severity: 'error',
          status: 'underway',
          message: 'не удалось подключить за 5 попыток',
        }),
      );
      expect(bus.events.map((e) => e.id)).toEqual(['f1']);
      expect(bus.events[0]?.message).toBe('не удалось подключить за 5 попыток');
    });

    it('I2: reconnecting and connect_failed collapse independently in one corr', () => {
      const bus = createNotificationBus();
      const corr = 'connection:3:link:abcd';
      bus.publish(
        evt({
          id: 'r1',
          correlationId: corr,
          code: 'connection.reconnecting',
          severity: 'warning',
          status: 'underway',
          message: 'попытка 1/5',
          data: { sender: 'supervisor' },
        }),
      );
      bus.publish(
        evt({
          id: 'f1',
          correlationId: corr,
          code: 'connection.connect_failed',
          severity: 'error',
          status: 'underway',
          message: 'fail 1/5',
        }),
      );
      bus.publish(
        evt({
          id: 'r2',
          correlationId: corr,
          code: 'connection.reconnecting',
          severity: 'warning',
          status: 'underway',
          message: 'попытка 2/5',
          data: { sender: 'supervisor' },
        }),
      );
      bus.publish(
        evt({
          id: 'f2',
          correlationId: corr,
          code: 'connection.connect_failed',
          severity: 'error',
          status: 'underway',
          message: 'fail 2/5',
        }),
      );
      expect(bus.events.map((e) => e.id).sort()).toEqual(['f1', 'r1'].sort());
      expect(bus.events.find((e) => e.code === 'connection.reconnecting')?.message).toBe('попытка 2/5');
      expect(bus.events.find((e) => e.code === 'connection.connect_failed')?.message).toBe('fail 2/5');
    });

    it('I2: repeated same (status, code) updates the row in place (progress tick)', () => {
      const bus = createNotificationBus();
      bus.publish(evt({ id: 'p1', correlationId: 'c', code: 'connection.recovering', status: 'underway', message: '4 c' }));
      bus.publish(evt({ id: 'p2', correlationId: 'c', code: 'connection.recovering', status: 'underway', message: '19 c' }));
      // Строка одна (id первого тика сохранён), но текст обновлён до последнего тика.
      expect(bus.events.map((e) => e.id)).toEqual(['p1']);
      expect(bus.events[0]?.message).toBe('19 c');
    });

    it('I2: in-place update keeps read state (no re-alert on progress)', () => {
      const bus = createNotificationBus();
      notify.warn(bus, { module: 'm', code: 'connection.recovering', message: '4 c', id: 'p1', correlationId: 'c', status: 'underway' });
      bus.markAllRead();
      expect(bus.unreadWarningCount).toBe(0);
      notify.warn(bus, { module: 'm', code: 'connection.recovering', message: '19 c', id: 'p2', correlationId: 'c', status: 'underway' });
      // Обновление текста не «зажигает» строку заново.
      expect(bus.unreadWarningCount).toBe(0);
      expect(bus.events[0]?.message).toBe('19 c');
    });

    it('badge follows last status: resolved alert does not burn', () => {
      const bus = createNotificationBus();
      notify.error(bus, { module: 'm', code: 'connection.lost', message: 'down', id: 'e1', correlationId: 'conn:1:link', status: 'active' });
      expect(bus.unreadAlertCount).toBe(1);
      notify.info(bus, { module: 'm', code: 'connection.recovered', message: 'up', id: 'e2', correlationId: 'conn:1:link', status: 'resolved' });
      expect(bus.unreadAlertCount).toBe(0);
    });

    it('re-entering a phase after another evicts the stale duplicate (no two ERRORs)', () => {
      const bus = createNotificationBus();
      // error-тик → warning → фолд 500 → error-тик снова (сценарий инцидента простоя с втянутым 500).
      bus.publish(evt({ id: 'e1', correlationId: 'c', code: 'backend.unavailable.progress', status: 'underway', message: '46 c' }));
      bus.publish(evt({ id: 'w1', correlationId: 'c', code: 'backend.recovering', status: 'underway', message: 'recovering' }));
      bus.publish(evt({ id: 'f1', correlationId: 'c', code: 'ohs.unhandled', severity: 'critical', status: 'active', message: '500' }));
      bus.publish(evt({ id: 'e2', correlationId: 'c', code: 'backend.unavailable.progress', status: 'underway', message: '57 c' }));
      // Тик: in-place update (id первой строки, текст последнего тика); прочие фазы сохранены.
      const errors = bus.events.filter((e) => e.code === 'backend.unavailable.progress');
      expect(errors.map((e) => e.id)).toEqual(['e1']);
      expect(errors[0]?.message).toBe('57 c');
      expect(bus.events.map((e) => e.code)).toEqual([
        'ohs.unhandled',
        'backend.recovering',
        'backend.unavailable.progress',
      ]);
    });

    it('§9.4: multiple distinct FATALs in one incident stay N rows (not collapsed)', () => {
      const bus = createNotificationBus();
      bus.publish(evt({ id: 'o1', correlationId: 'c', code: 'backend.unavailable', severity: 'critical', status: 'active', message: 'down' }));
      bus.publish(evt({ id: 'u1', correlationId: 'c', code: 'ohs.unhandled', severity: 'critical', status: 'active', message: '500 #1' }));
      bus.publish(evt({ id: 'u2', correlationId: 'c', code: 'ohs.unhandled', severity: 'critical', status: 'active', message: '500 #2' }));
      bus.publish(evt({ id: 'u3', correlationId: 'c', code: 'ohs.unhandled', severity: 'critical', status: 'active', message: '500 #3' }));
      // Три разных 500 (один corr/code/status) — три отдельные строки, а не одна схлопнутая (live = reload).
      const unhandled = bus.events.filter((e) => e.code === 'ohs.unhandled');
      expect(unhandled.map((e) => e.id)).toEqual(['u3', 'u2', 'u1']);
      expect(bus.events.map((e) => e.id)).toEqual(['u3', 'u2', 'u1', 'o1']);
    });

    it('§9.5: after reload, stack order follows ts (not insert order of backdated open)', () => {
      const bus = createNotificationBus();
      // Как в БД после mock-POST: warning записан раньше, open — backdated при resolve, потом ok.
      bus.publish(
        evt({
          id: 'w',
          correlationId: 'ohs.backend.outage:1',
          code: 'backend.recovering',
          severity: 'warning',
          status: 'underway',
          ts: '2026-07-25T15:36:42.000Z',
        }),
      );
      bus.publish(
        evt({
          id: 'f',
          correlationId: 'ohs.backend.outage:1',
          code: 'backend.unavailable',
          severity: 'critical',
          status: 'active',
          ts: '2026-07-25T15:36:02.000Z',
        }),
      );
      bus.publish(
        evt({
          id: 'ok',
          correlationId: 'ohs.backend.outage:1',
          code: 'backend.recovered',
          severity: 'ok',
          status: 'resolved',
          ts: '2026-07-25T15:36:48.000Z',
        }),
      );
      // Newest-first по ts: ok → warning → fatal (чтение снизу вверх = причина → чиним → закрыто).
      expect(bus.events.map((e) => e.code)).toEqual([
        'backend.recovered',
        'backend.recovering',
        'backend.unavailable',
      ]);
    });

    it('§9.2: each recovering entry stays a separate row (not collapsed)', () => {
      const bus = createNotificationBus();
      const corr = 'ohs.backend.outage:1';
      bus.publish(
        evt({
          id: 'open',
          correlationId: corr,
          code: 'backend.unavailable',
          severity: 'critical',
          status: 'active',
          ts: '2026-07-25T15:00:00.000Z',
        }),
      );
      bus.publish(
        evt({
          id: 'w1',
          correlationId: corr,
          code: 'backend.recovering',
          severity: 'warning',
          status: 'underway',
          ts: '2026-07-25T15:00:10.000Z',
        }),
      );
      bus.publish(
        evt({
          id: 'f1',
          correlationId: corr,
          code: 'ohs.unhandled',
          severity: 'critical',
          status: 'active',
          ts: '2026-07-25T15:00:11.000Z',
        }),
      );
      bus.publish(
        evt({
          id: 'w2',
          correlationId: corr,
          code: 'backend.recovering',
          severity: 'warning',
          status: 'underway',
          ts: '2026-07-25T15:00:16.000Z',
        }),
      );
      bus.publish(
        evt({
          id: 'f2',
          correlationId: corr,
          code: 'ohs.unhandled',
          severity: 'critical',
          status: 'active',
          ts: '2026-07-25T15:00:17.000Z',
        }),
      );
      bus.publish(
        evt({
          id: 'w3',
          correlationId: corr,
          code: 'backend.recovering',
          severity: 'warning',
          status: 'underway',
          ts: '2026-07-25T15:00:22.000Z',
        }),
      );
      bus.publish(
        evt({
          id: 'ok',
          correlationId: corr,
          code: 'backend.recovered',
          severity: 'ok',
          status: 'resolved',
          ts: '2026-07-25T15:00:27.000Z',
        }),
      );
      expect(bus.events.map((e) => e.id)).toEqual(['ok', 'w3', 'f2', 'w2', 'f1', 'w1', 'open']);
    });

    it('re-open (→ active) re-alerts via a fresh unread row', () => {
      const bus = createNotificationBus();
      notify.error(bus, { module: 'm', code: 'connection.schedule_error', message: 'down', id: 'e1', correlationId: 'c', status: 'active' });
      bus.markAllRead();
      expect(bus.unreadAlertCount).toBe(0);
      notify.error(bus, { module: 'm', code: 'connection.schedule_error', message: 'down again', id: 'e2', correlationId: 'c', status: 'active' });
      // Non-tick: вторая ошибка — новая строка и снова unread.
      expect(bus.unreadAlertCount).toBe(1);
      notify.info(bus, { module: 'm', code: 'connection.recovered', message: 'up', id: 'e3', correlationId: 'c', status: 'resolved' });
      expect(bus.unreadAlertCount).toBe(0);
      notify.error(bus, { module: 'm', code: 'connection.schedule_error', message: 'flap', id: 'e4', correlationId: 'c', status: 'active' });
      expect(bus.statusOf('c')).toBe('active');
      expect(bus.unreadAlertCount).toBe(1);
    });

    it('discrete connection.lost keeps Degraded and Down as separate unread rows', () => {
      const bus = createNotificationBus();
      notify.error(bus, {
        module: 'm',
        code: 'connection.lost',
        message: 'Degraded',
        id: 'd1',
        correlationId: 'c',
        status: 'active',
      });
      bus.markAllRead();
      notify.error(bus, {
        module: 'm',
        code: 'connection.lost',
        message: 'Down',
        id: 'd2',
        correlationId: 'c',
        status: 'active',
      });
      expect(bus.events.map((e) => e.id)).toEqual(['d2', 'd1']);
      expect(bus.unreadAlertCount).toBe(1);
    });

    it('discrete: each operator connect attempt keeps its info+warn (no I2 collapse)', () => {
      const bus = createNotificationBus();
      const corr = 'connection:3:link:abcd';
      bus.publish(
        evt({
          id: 'i1',
          correlationId: corr,
          code: 'connection.connect',
          severity: 'info',
          status: 'underway',
          message: 'cmd 1',
          data: { sender: 'user' },
        }),
      );
      bus.publish(
        evt({
          id: 'w1',
          correlationId: corr,
          code: 'connection.reconnecting',
          severity: 'warning',
          status: 'underway',
          message: 'restore 1',
          data: { sender: 'user' },
        }),
      );
      bus.publish(
        evt({
          id: 'f1',
          correlationId: corr,
          code: 'connection.connect_failed',
          severity: 'error',
          status: 'underway',
          message: 'fail 1',
        }),
      );
      bus.publish(
        evt({
          id: 'i2',
          correlationId: corr,
          code: 'connection.connect',
          severity: 'info',
          status: 'underway',
          message: 'cmd 2',
          data: { sender: 'user' },
        }),
      );
      bus.publish(
        evt({
          id: 'w2',
          correlationId: corr,
          code: 'connection.reconnecting',
          severity: 'warning',
          status: 'underway',
          message: 'restore 2',
          data: { sender: 'user' },
        }),
      );
      expect(bus.events.map((e) => e.id)).toEqual(['w2', 'i2', 'f1', 'w1', 'i1']);
    });

    it('I2: supervisor reconnecting ticks still collapse in place', () => {
      const bus = createNotificationBus();
      bus.publish(
        evt({
          id: 'r1',
          correlationId: 'c',
          code: 'connection.reconnecting',
          status: 'underway',
          message: 'попытка 1/5',
          data: { sender: 'supervisor' },
        }),
      );
      bus.publish(
        evt({
          id: 'r2',
          correlationId: 'c',
          code: 'connection.reconnecting',
          status: 'underway',
          message: 'попытка 2/5',
          data: { sender: 'supervisor' },
        }),
      );
      expect(bus.events.map((e) => e.id)).toEqual(['r1']);
      expect(bus.events[0]?.message).toBe('попытка 2/5');
    });

    it('I2: auto connecting ticks (попытка k/5) collapse in place', () => {
      const bus = createNotificationBus();
      const corr = 'connection:3:auto:abcd';
      bus.publish(
        evt({
          id: 'c1',
          correlationId: corr,
          code: 'connection.connecting',
          status: 'underway',
          message: 'попытка 1/5',
        }),
      );
      bus.publish(
        evt({
          id: 'c2',
          correlationId: corr,
          code: 'connection.connecting',
          status: 'underway',
          message: 'попытка 2/5',
        }),
      );
      bus.publish(
        evt({
          id: 'c3',
          correlationId: corr,
          code: 'connection.connecting',
          status: 'underway',
          message: 'попытка 3/5',
        }),
      );
      expect(bus.events.map((e) => e.id)).toEqual(['c1']);
      expect(bus.events[0]?.message).toBe('попытка 3/5');
    });

    it('Settings: collapsePhaseTicks off keeps all ticks; on restores fold from raw', () => {
      const bus = createNotificationBus({ collapsePhaseTicks: false });
      const corr = 'connection:3:link:abcd';
      bus.publish(
        evt({
          id: 'f1',
          correlationId: corr,
          code: 'connection.connect_failed',
          severity: 'error',
          status: 'underway',
          message: '1/5',
        }),
      );
      bus.publish(
        evt({
          id: 'f2',
          correlationId: corr,
          code: 'connection.connect_failed',
          severity: 'error',
          status: 'underway',
          message: '2/5',
        }),
      );
      expect(bus.events.map((e) => e.id)).toEqual(['f2', 'f1']);
      expect(bus.rawEvents.map((e) => e.id)).toEqual(['f2', 'f1']);

      bus.setCollapsePhaseTicks(true);
      expect(bus.events.map((e) => e.id)).toEqual(['f1']);
      expect(bus.events[0]?.message).toBe('2/5');
      expect(bus.rawEvents.map((e) => e.id)).toEqual(['f2', 'f1']);

      bus.setCollapsePhaseTicks(false);
      expect(bus.events.map((e) => e.id)).toEqual(['f2', 'f1']);
    });
  });
});
