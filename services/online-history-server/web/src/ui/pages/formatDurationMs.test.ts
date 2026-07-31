import { describe, expect, it } from 'vitest';
import { formatDurationMs } from './formatDurationMs';

describe('formatDurationMs', () => {
  it('formats under a day as HH:MM:SS', () => {
    expect(formatDurationMs(90_000)).toBe('00:01:30');
    expect(formatDurationMs(0)).toBe('00:00:00');
  });

  it('includes days when needed', () => {
    expect(formatDurationMs(90_000 + 86_400_000)).toBe('1d 00:01:30');
  });
});
