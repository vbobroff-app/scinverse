import { describe, expect, it } from 'vitest';
import {
  createOffsetFormatTs,
  formatThreadTimeLabel,
  formatThreadTs,
  formatTsUtc,
} from './formatTs';

describe('formatTs', () => {
  it('formats UTC', () => {
    expect(formatTsUtc('2026-07-14T12:34:56.000Z')).toBe('2026-07-14 12:34:56');
  });

  it('formats by fixed offset (MSK = +180)', () => {
    const format = createOffsetFormatTs(180);
    expect(format('2026-07-14T12:34:56.000Z')).toBe('2026-07-14 15:34:56');
  });
});

describe('formatThreadTs', () => {
  // 2026-07-29 17:27:42 MSK = 14:27:42Z; «сегодня» = тот же день МСК.
  const nowMsk = Date.parse('2026-07-29T20:00:00.000Z'); // 23:00 МСК

  it('omits date when same calendar day in display TZ', () => {
    expect(formatThreadTs('2026-07-29T14:27:42.000Z', 180, nowMsk)).toBe('17:27:42');
  });

  it('keeps date when not today in display TZ', () => {
    expect(formatThreadTs('2026-07-28T14:27:42.000Z', 180, nowMsk)).toBe(
      '2026-07-28 17:27:42',
    );
  });

  it('formats closed span with per-side today rule', () => {
    expect(
      formatThreadTimeLabel(
        '2026-07-29T14:27:42.000Z',
        '2026-07-29T14:38:22.000Z',
        180,
        nowMsk,
      ),
    ).toBe('17:27:42 → 17:38:22');

    expect(
      formatThreadTimeLabel(
        '2026-07-28T20:50:00.000Z',
        '2026-07-29T14:10:00.000Z',
        180,
        nowMsk,
      ),
    ).toBe('2026-07-28 23:50:00 → 17:10:00');
  });

  it('collapses identical ends; open active uses open→last', () => {
    expect(
      formatThreadTimeLabel(
        '2026-07-29T14:27:42.000Z',
        '2026-07-29T14:27:42.000Z',
        180,
        nowMsk,
      ),
    ).toBe('17:27:42');

    expect(
      formatThreadTimeLabel(
        '2026-07-29T14:27:42.000Z',
        '2026-07-29T15:00:00.000Z',
        180,
        nowMsk,
      ),
    ).toBe('17:27:42 → 18:00:00');
  });
});
