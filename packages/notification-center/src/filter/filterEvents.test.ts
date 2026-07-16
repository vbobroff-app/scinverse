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

  it('filters by ready RangeBounds', () => {
    const bounds = resolveRangeBounds({ preset: 'custom', from: '2026-07-14', to: '2026-07-14' });
    expect(filterEvents(sample, { range: bounds }).map((e) => e.id)).toEqual(['1', '2']);
  });

  it('range all does not restrict', () => {
    expect(filterEvents(sample, { range: { preset: 'all' } })).toHaveLength(2);
  });
});
