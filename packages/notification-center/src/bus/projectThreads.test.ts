import { describe, expect, it } from 'vitest';
import { createNotificationBus } from './NotificationBus';
import { deriveSubject, projectThreads } from './projectThreads';
import type { NotificationEvent, ThreadItem } from '../types';
import { isSingleItem, isThreadItem } from '../types';

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

function threadOf(items: ReturnType<typeof projectThreads>, uid: string): ThreadItem {
  const t = items.find((i) => i.itemKind === 'thread' && i.uid === uid);
  expect(t).toBeDefined();
  return t as ThreadItem;
}

describe('projectThreads', () => {
  it('Single without correlationId stays Single', () => {
    const items = projectThreads([
      evt({ id: 's1', code: 'recording.started', message: 'start' }),
    ]);
    expect(items).toHaveLength(1);
    expect(isSingleItem(items[0]!)).toBe(true);
    if (isSingleItem(items[0]!)) {
      expect(items[0].id).toBe('s1');
      expect(items[0].itemKind).toBe('single');
    }
  });

  it('lost → recovering → recovered projects Incident resolved', () => {
    const corr = 'connection:c1:link';
    const items = projectThreads([
      evt({
        id: 'close',
        correlationId: corr,
        code: 'connection.recovered',
        status: 'resolved',
        severity: 'ok',
        ts: '2026-07-14T12:02:00.000Z',
        data: { closeOutcome: 'recovered' },
      }),
      evt({
        id: 'rec',
        correlationId: corr,
        code: 'connection.recovering',
        status: 'underway',
        severity: 'warning',
        ts: '2026-07-14T12:01:00.000Z',
      }),
      evt({
        id: 'open',
        correlationId: corr,
        code: 'connection.lost',
        status: 'active',
        severity: 'error',
        ts: '2026-07-14T12:00:00.000Z',
        data: { threadKindHint: 'incident' },
      }),
    ]);

    expect(items).toHaveLength(1);
    const t = threadOf(items, corr);
    expect(t.threadKind).toBe('incident');
    expect(t.threadStatus).toBe('resolved');
    expect(t.closeOutcome).toBe('recovered');
    expect(t.openedAt).toBe('2026-07-14T12:00:00.000Z');
    expect(t.closedAt).toBe('2026-07-14T12:02:00.000Z');
    expect(t.lastActivityAt).toBe('2026-07-14T12:02:00.000Z');
    expect(t.notifications.map((e) => e.id)).toEqual(['open', 'rec', 'close']);
    expect(t.subject).toBe('connection:c1');
  });

  it('schedule abandon → resolved with abandoned_schedule', () => {
    const corr = 'connection:c2:link';
    const items = projectThreads([
      evt({
        id: 'closed',
        correlationId: corr,
        code: 'connection.incident_closed',
        status: 'resolved',
        severity: 'warning',
        ts: '2026-07-14T18:00:00.000Z',
        data: { closeOutcome: 'abandoned_schedule' },
      }),
      evt({
        id: 'open',
        correlationId: corr,
        code: 'connection.lost',
        status: 'active',
        severity: 'error',
        ts: '2026-07-14T10:00:00.000Z',
        data: { threadKindHint: 'incident' },
      }),
    ]);

    const t = threadOf(items, corr);
    expect(t.threadKind).toBe('incident');
    expect(t.threadStatus).toBe('resolved');
    expect(t.closeOutcome).toBe('abandoned_schedule');
  });

  it('orphan recovering → Thread with one Entry, no fake open', () => {
    const corr = 'ohs.backend.outage:orphan';
    const items = projectThreads([
      evt({
        id: 'w1',
        correlationId: corr,
        code: 'backend.recovering',
        status: 'underway',
        severity: 'warning',
        ts: '2026-07-14T12:00:00.000Z',
      }),
    ]);

    const t = threadOf(items, corr);
    expect(t.notifications).toHaveLength(1);
    expect(t.notifications[0]?.id).toBe('w1');
    expect(t.threadStatus).toBe('recovering');
    // без open-кода / hint → group (безопаснее)
    expect(t.threadKind).toBe('group');
  });

  it('crash layer C: subject + header title bind to connectionId', () => {
    expect(deriveSubject('ohs.backend.outage:1720000000000:c3')).toBe('connection:3');
    const corr = 'ohs.backend.outage:1720000000000:c3';
    const closeMsg = 'Подключение 3: Система восстановлена';
    const items = projectThreads([
      evt({
        id: 'o1',
        correlationId: corr,
        code: 'backend.unavailable',
        status: 'active',
        severity: 'critical',
        message: 'Подключение 3: Сервер OHS недоступен, жду восстановления',
        ts: '2026-07-14T12:00:00.000Z',
        data: { connectionId: 3, threadKindHint: 'incident', kind: 'crash' },
      }),
      evt({
        id: 'c1',
        correlationId: corr,
        code: 'backend.recovered',
        status: 'resolved',
        severity: 'ok',
        message: closeMsg,
        ts: '2026-07-14T12:05:00.000Z',
        data: { connectionId: 3, kind: 'crash', closeOutcome: 'recovered' },
      }),
    ]);
    const t = threadOf(items, corr);
    expect(t.subject).toBe('connection:3');
    // Как break: title = connection:{id}; message без изменений («Подключение 3: …»).
    expect(t.header.title).toBe('connection:3');
    expect(t.notifications.map((n) => n.message)).toEqual([
      'Подключение 3: Сервер OHS недоступен, жду восстановления',
      closeMsg,
    ]);
  });

  it('same ts: ok Entry sorts after warning (UI reverse → ok above warn)', () => {
    const corr = 'auto:connection:3:connect:1';
    const ts = '2026-07-30T12:48:05.000Z';
    const items = projectThreads([
      evt({
        id: 'zzz-warn',
        correlationId: corr,
        code: 'connection.connecting',
        message: 'подключаю…',
        severity: 'warning',
        status: 'underway',
        ts,
        data: { threadKindHint: 'group' },
      }),
      evt({
        id: 'aaa-ok',
        correlationId: corr,
        code: 'connection.connected',
        message: 'связь установлена',
        severity: 'ok',
        status: 'resolved',
        ts,
        data: { threadKindHint: 'group' },
      }),
    ]);
    const t = threadOf(items, corr);
    // oldest-first: warn → ok; ThreadBlock reverse → ok сверху.
    expect(t.notifications.map((n) => n.severity)).toEqual(['warning', 'ok']);
  });

  it('threadKindHint group wins over open-code heuristic', () => {
    const corr = 'connection:c3:link';
    const items = projectThreads([
      evt({
        id: 'open',
        correlationId: corr,
        code: 'connection.lost',
        status: 'active',
        severity: 'error',
        data: { threadKindHint: 'group' },
      }),
    ]);
    expect(threadOf(items, corr).threadKind).toBe('group');
  });

  it('known open code without hint → incident', () => {
    const corr = 'connection:c4:link';
    const items = projectThreads([
      evt({
        id: 'open',
        correlationId: corr,
        code: 'backend.unavailable',
        status: 'active',
        severity: 'critical',
      }),
    ]);
    const t = threadOf(items, corr);
    expect(t.threadKind).toBe('incident');
    expect(t.threadStatus).toBe('active');
  });

  it('merges Single + Thread by lastActivityAt (newest first)', () => {
    const corr = 'connection:c5:link';
    const items = projectThreads([
      evt({
        id: 's-old',
        code: 'user.click',
        ts: '2026-07-14T11:00:00.000Z',
      }),
      evt({
        id: 'open',
        correlationId: corr,
        code: 'connection.lost',
        status: 'active',
        severity: 'error',
        ts: '2026-07-14T12:00:00.000Z',
      }),
      evt({
        id: 's-new',
        code: 'user.click',
        ts: '2026-07-14T13:00:00.000Z',
      }),
    ]);

    expect(items.map((i) => (isThreadItem(i) ? i.uid : i.id))).toEqual([
      's-new',
      corr,
      's-old',
    ]);
  });

  it('open Incident: Single WARN above Thread; resolved Incident rises; resolved Group stays below INFO', () => {
    const corr = 'connection:3:link:c4e5b051';
    const ts = '2026-07-29T08:16:48.000Z';
    const warnId = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
    const openItems = projectThreads([
      evt({
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        correlationId: corr,
        code: 'connection.connect_failed',
        status: 'active',
        severity: 'error',
        message: 'fail ×5',
        ts,
      }),
      evt({
        id: warnId,
        code: 'connection.auto_stopped',
        severity: 'warning',
        message: 'Auto stopped',
        ts,
      }),
    ]);
    expect(openItems.map((i) => (isThreadItem(i) ? i.uid : i.id))).toEqual([warnId, corr]);
    expect(threadOf(openItems, corr).threadStatus).toBe('active');

    // Resolve позже → lastActivityAt новее → Incident выше WARN.
    const resolvedLater = projectThreads([
      evt({
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        correlationId: corr,
        code: 'connection.connect_failed',
        status: 'active',
        severity: 'error',
        ts,
      }),
      evt({
        id: warnId,
        code: 'connection.auto_stopped',
        severity: 'warning',
        ts,
      }),
      evt({
        id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        correlationId: corr,
        code: 'connection.recovered',
        status: 'resolved',
        severity: 'ok',
        ts: '2026-07-29T08:20:00.000Z',
      }),
    ]);
    expect(resolvedLater.map((i) => (isThreadItem(i) ? i.uid : i.id))).toEqual([corr, warnId]);

    // Resolve в ту же секунду, что WARN → tie-break: resolved Incident над Single.
    const resolvedSameTs = projectThreads([
      evt({
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        correlationId: corr,
        code: 'connection.lost',
        status: 'active',
        severity: 'error',
        ts,
      }),
      evt({
        id: warnId,
        code: 'connection.auto_stopped',
        severity: 'warning',
        ts,
      }),
      evt({
        id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        correlationId: corr,
        code: 'connection.recovered',
        status: 'resolved',
        severity: 'ok',
        ts,
      }),
    ]);
    expect(resolvedSameTs.map((i) => (isThreadItem(i) ? i.uid : i.id))).toEqual([corr, warnId]);

    // Auto Group + INFO schedule_connect (тот же ts) → INFO выше Group.
    const autoCorr = 'connection:3:auto:deadbeef';
    const infoId = 'cccccccccccccccccccccccccccccccc';
    const schedulePair = projectThreads([
      evt({
        id: 'dddddddddddddddddddddddddddddddd',
        correlationId: autoCorr,
        code: 'connection.connecting',
        status: 'underway',
        severity: 'warning',
        message: 'подключаю по расписанию…',
        ts,
        data: { threadKindHint: 'group' },
      }),
      evt({
        id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        correlationId: autoCorr,
        code: 'connection.connected',
        status: 'resolved',
        severity: 'ok',
        message: 'связь установлена (Auto)',
        ts,
        data: { threadKindHint: 'group' },
      }),
      evt({
        id: infoId,
        code: 'connection.schedule_connect',
        severity: 'info',
        message: 'плановое подключение по расписанию',
        ts,
      }),
    ]);
    expect(schedulePair.map((i) => (isThreadItem(i) ? i.uid : i.id))).toEqual([infoId, autoCorr]);
    expect(threadOf(schedulePair, autoCorr).threadKind).toBe('group');
  });

  it('Group and Incident with different corr stay two threads', () => {
    const items = projectThreads([
      evt({
        id: 'g1',
        correlationId: 'connection:g:link',
        code: 'connection.lost',
        status: 'active',
        data: { threadKindHint: 'group' },
        ts: '2026-07-14T12:00:00.000Z',
      }),
      evt({
        id: 'i1',
        correlationId: 'connection:i:link',
        code: 'connection.lost',
        status: 'active',
        data: { threadKindHint: 'incident' },
        ts: '2026-07-14T12:01:00.000Z',
      }),
    ]);
    expect(items.filter(isThreadItem)).toHaveLength(2);
    expect(threadOf(items, 'connection:g:link').threadKind).toBe('group');
    expect(threadOf(items, 'connection:i:link').threadKind).toBe('incident');
  });
});

describe('NotificationBus items$ / events$', () => {
  it('items$ projects after publish; events$ mirrors flat audit', () => {
    const bus = createNotificationBus();
    const corr = 'connection:bus:link';
    bus.publish(
      evt({
        id: 'open',
        correlationId: corr,
        code: 'connection.lost',
        status: 'active',
        severity: 'error',
        ts: '2026-07-14T12:00:00.000Z',
        data: { threadKindHint: 'incident' },
      }),
    );
    bus.publish(
      evt({
        id: 'solo',
        code: 'ping',
        message: 'solo',
        ts: '2026-07-14T13:00:00.000Z',
      }),
    );

    expect(bus.events$).toBe(bus.stream$);
    expect(bus.events.map((e) => e.id)).toEqual(['solo', 'open']);
    expect(bus.items).toHaveLength(2);
    expect(bus.items[0]?.itemKind).toBe('single');
    expect(bus.items[1]?.itemKind).toBe('thread');
  });
});
