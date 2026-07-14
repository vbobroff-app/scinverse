import { describe, expect, it } from 'vitest';
import { filterEvents } from './filterEvents';
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

  it('filters by query across message/code/module', () => {
    expect(filterEvents(sample, { query: 'recording' }).map((e) => e.id)).toEqual(['1']);
    expect(filterEvents(sample, { query: 'transaq' }).map((e) => e.id)).toEqual(['2']);
    expect(filterEvents(sample, { query: 'разрыв' }).map((e) => e.id)).toEqual(['2']);
  });

  it('empty filter sets mean no restriction', () => {
    expect(filterEvents(sample, { severities: [] })).toHaveLength(2);
  });
});
