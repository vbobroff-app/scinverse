import { describe, expect, it } from 'vitest';
import {
  formatLocalYmd,
  parseLocalYmd,
  rangeSummary,
  resolveRangeBounds,
} from './dateRange';

describe('dateRange', () => {
  it('parses and formats local YYYY-MM-DD', () => {
    const d = parseLocalYmd('2026-07-16');
    expect(d).not.toBeNull();
    expect(formatLocalYmd(d!)).toBe('2026-07-16');
    expect(parseLocalYmd('2026-02-30')).toBeNull();
  });

  it('resolves today / yesterday / week from local calendar', () => {
    const now = new Date(2026, 6, 16, 18, 30, 0); // Jul 16 local
    expect(resolveRangeBounds({ preset: 'today' }, now)).toEqual({
      fromMs: new Date(2026, 6, 16).getTime(),
      toMs: null,
    });
    expect(resolveRangeBounds({ preset: 'yesterday' }, now)).toEqual({
      fromMs: new Date(2026, 6, 15).getTime(),
      toMs: null,
    });
    expect(resolveRangeBounds({ preset: 'days3' }, now)).toEqual({
      fromMs: new Date(2026, 6, 14).getTime(),
      toMs: null,
    });
    expect(resolveRangeBounds({ preset: 'week' }, now)).toEqual({
      fromMs: new Date(2026, 6, 10).getTime(),
      toMs: null,
    });
    expect(resolveRangeBounds({ preset: 'all' }, now)).toEqual({
      fromMs: null,
      toMs: null,
    });
  });

  it('resolves custom inclusive day bounds', () => {
    const bounds = resolveRangeBounds({
      preset: 'custom',
      from: '2026-07-10',
      to: '2026-07-12',
    });
    expect(bounds.fromMs).toBe(new Date(2026, 6, 10).getTime());
    expect(bounds.toMs).toBe(new Date(2026, 6, 12).getTime() + 86_400_000 - 1);
  });

  it('summarizes presets and custom', () => {
    expect(rangeSummary({ preset: 'today' })).toBe('за сегодня');
    expect(rangeSummary({ preset: 'custom' })).toBe('даты…');
    expect(rangeSummary({ preset: 'custom', from: '2026-07-01', to: '2026-07-10' })).toBe(
      '2026-07-01 — 2026-07-10',
    );
  });
});
