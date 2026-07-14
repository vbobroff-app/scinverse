import { describe, expect, it } from 'vitest';
import { createOffsetFormatTs, formatTsUtc } from './formatTs';

describe('formatTs', () => {
  it('formats UTC', () => {
    expect(formatTsUtc('2026-07-14T12:34:56.000Z')).toBe('2026-07-14 12:34:56');
  });

  it('formats by fixed offset (MSK = +180)', () => {
    const format = createOffsetFormatTs(180);
    expect(format('2026-07-14T12:34:56.000Z')).toBe('2026-07-14 15:34:56');
  });
});
