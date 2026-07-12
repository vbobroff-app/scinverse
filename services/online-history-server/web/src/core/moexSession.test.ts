import { describe, expect, it } from 'vitest';
import { mergeSessionHours } from './moexSession';
import type { SessionDto } from './types';

describe('mergeSessionHours', () => {
  it('подменяет start/end/weekend для совпадающих дат', () => {
    const calendar: SessionDto[] = [
      { date: '2026-07-08', start: 'local-start', end: 'local-end', weekend: false },
      { date: '2026-07-07', start: 'keep', end: 'keep', weekend: false },
    ];
    const api: SessionDto[] = [
      { date: '2026-07-08', start: 'iss-start', end: 'iss-end', weekend: false },
    ];

    const merged = mergeSessionHours(calendar, api);

    expect(merged[0]).toEqual({ date: '2026-07-08', start: 'iss-start', end: 'iss-end', weekend: false });
    expect(merged[1]).toEqual(calendar[1]);
  });

  it('при пустом API возвращает календарь без изменений', () => {
    const calendar: SessionDto[] = [
      { date: '2026-07-08', start: 'a', end: 'b', weekend: false },
    ];
    expect(mergeSessionHours(calendar, [])).toEqual(calendar);
  });
});
