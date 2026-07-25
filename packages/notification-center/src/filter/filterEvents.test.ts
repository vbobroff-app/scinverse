import { describe, expect, it } from 'vitest';
import { filterEvents } from './filterEvents';
import { resolveRangeBounds } from './dateRange';
import type { NotificationEvent } from '../types';

const sample: NotificationEvent[] = [
  {
    id: '1',
    ts: '2026-07-14T10:00:00.000Z',
    severity: 'info',
    sourceType: 'user',
    module: 'ohs.recording',
    code: 'recording.started',
    message: 'Запись стартовала',
  },
  {
    id: '2',
    ts: '2026-07-14T10:01:00.000Z',
    severity: 'error',
    sourceType: 'external',
    module: 'connector.transaq',
    code: 'connection.error',
    message: 'Разрыв связи',
  },
];

describe('filterEvents', () => {
  it('filters by severity and sourceType (AND)', () => {
    const out = filterEvents(sample, {
      severities: ['error'],
      sourceTypes: ['external'],
    });
    expect(out.map((e) => e.id)).toEqual(['2']);
  });

  it('filters by interaction and localization resolved from sourceType', () => {
    expect(
      filterEvents(sample, { interactions: ['user'], localizations: ['internal'] }).map((e) => e.id),
    ).toEqual(['1']);
    expect(
      filterEvents(sample, { localizations: ['external'] }).map((e) => e.id),
    ).toEqual(['2']);
  });

  it('filters by query across message/code/module', () => {
    expect(filterEvents(sample, { query: 'recording' }).map((e) => e.id)).toEqual(['1']);
    expect(filterEvents(sample, { query: 'transaq' }).map((e) => e.id)).toEqual(['2']);
    expect(filterEvents(sample, { query: 'разрыв' }).map((e) => e.id)).toEqual(['2']);
  });

  it('empty filter sets mean no restriction', () => {
    expect(filterEvents(sample, { severities: [] })).toHaveLength(2);
  });

  it('filters by range preset (today)', () => {
    const now = new Date(2026, 6, 16, 15, 0, 0); // local Jul 16
    const events: NotificationEvent[] = [
      { ...sample[0], id: 'old', ts: '2026-07-15T12:00:00.000Z' },
      { ...sample[0], id: 'today', ts: new Date(2026, 6, 16, 10, 0, 0).toISOString() },
    ];
    expect(
      filterEvents(events, { range: { preset: 'today' } }, now).map((e) => e.id),
    ).toEqual(['today']);
  });

  it('filters by custom date bounds', () => {
    const events: NotificationEvent[] = [
      { ...sample[0], id: 'a', ts: new Date(2026, 6, 10, 12, 0, 0).toISOString() },
      { ...sample[0], id: 'b', ts: new Date(2026, 6, 12, 12, 0, 0).toISOString() },
      { ...sample[0], id: 'c', ts: new Date(2026, 6, 14, 12, 0, 0).toISOString() },
    ];
    expect(
      filterEvents(events, {
        range: { preset: 'custom', from: '2026-07-11', to: '2026-07-13' },
      }).map((e) => e.id),
    ).toEqual(['b']);
  });

  it('filters today ∩ time window (15:00–24:00 continuous)', () => {
    const now = new Date(2026, 6, 16, 20, 0, 0);
    const events: NotificationEvent[] = [
      { ...sample[0], id: 'morning', ts: new Date(2026, 6, 16, 10, 0, 0).toISOString() },
      { ...sample[0], id: 'evening', ts: new Date(2026, 6, 16, 16, 30, 0).toISOString() },
      { ...sample[0], id: 'yesterdayEve', ts: new Date(2026, 6, 15, 16, 30, 0).toISOString() },
    ];
    expect(
      filterEvents(
        events,
        {
          range: {
            preset: 'today',
            timeEnabled: true,
            timeFrom: '15:00',
            timeTo: '24:00',
          },
        },
        now,
      ).map((e) => e.id),
    ).toEqual(['evening']);
  });

  it('time-only on all filters by clock time', () => {
    const events: NotificationEvent[] = [
      { ...sample[0], id: 'a', ts: new Date(2026, 6, 10, 10, 0, 0).toISOString() },
      { ...sample[0], id: 'b', ts: new Date(2026, 6, 12, 16, 0, 0).toISOString() },
    ];
    expect(
      filterEvents(events, {
        range: {
          preset: 'all',
          timeEnabled: true,
          timeFrom: '15:00',
          timeTo: '18:00',
        },
      }).map((e) => e.id),
    ).toEqual(['b']);
  });

  it('filters by range in display TZ (MSK), matching formatTs', () => {
    // 12:30 UTC = 15:30 МСК — попадает в 15:00–16:00 МСК
    // 11:30 UTC = 14:30 МСК — не попадает
    const events: NotificationEvent[] = [
      { ...sample[0], id: 'in', ts: '2026-07-16T12:30:00.000Z' },
      { ...sample[0], id: 'out', ts: '2026-07-16T11:30:00.000Z' },
    ];
    const now = new Date('2026-07-16T14:00:00.000Z'); // 17:00 МСК
    expect(
      filterEvents(
        events,
        {
          tzOffsetMin: 180,
          range: {
            preset: 'today',
            timeEnabled: true,
            timeFrom: '15:00',
            timeTo: '16:00',
          },
        },
        now,
      ).map((e) => e.id),
    ).toEqual(['in']);
  });

  it('filters by ready RangeBounds', () => {
    const bounds = resolveRangeBounds({ preset: 'custom', from: '2026-07-14', to: '2026-07-14' });
    expect(filterEvents(sample, { range: bounds }).map((e) => e.id)).toEqual(['1', '2']);
  });

  it('range all does not restrict', () => {
    expect(filterEvents(sample, { range: { preset: 'all' } })).toHaveLength(2);
  });

  it('filters by lifecycle status (default active when absent)', () => {
    const events: NotificationEvent[] = [
      { ...sample[0], id: 'a', status: 'active' },
      { ...sample[0], id: 'u', status: 'underway' },
      { ...sample[0], id: 'r', status: 'resolved' },
      { ...sample[0], id: 'n' }, // без status ⇒ active
    ];
    expect(filterEvents(events, { statuses: ['active'] }).map((e) => e.id)).toEqual(['a', 'n']);
    expect(filterEvents(events, { statuses: ['resolved'] }).map((e) => e.id)).toEqual(['r']);
    expect(
      filterEvents(events, { statuses: ['active', 'underway'] }).map((e) => e.id),
    ).toEqual(['a', 'u', 'n']);
  });
});
