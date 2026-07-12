import { bucketSecondsForTimeframe } from './activityBucket';
import type { Timeframe, TimeframeUnit } from './types';

function sessions(unit: TimeframeUnit, count: number): Timeframe {
  return { kind: 'sessions', unit, count, includeWeekends: true };
}

describe('bucketSecondsForTimeframe — лесенка бакетов', () => {
  it('D1 → 30 c', () => {
    expect(bucketSecondsForTimeframe(sessions('D', 1))).toBe(30);
  });

  it('D2–D3 → 1 мин', () => {
    expect(bucketSecondsForTimeframe(sessions('D', 2))).toBe(60);
    expect(bucketSecondsForTimeframe(sessions('D', 3))).toBe(60);
  });

  it('W → 5 мин', () => {
    expect(bucketSecondsForTimeframe(sessions('W', 1))).toBe(300);
  });

  it('M → 30 мин', () => {
    expect(bucketSecondsForTimeframe(sessions('M', 1))).toBe(1800);
  });

  it('Q → 2 ч', () => {
    expect(bucketSecondsForTimeframe(sessions('Q', 1))).toBe(7200);
  });

  it('Y → 12 ч', () => {
    expect(bucketSecondsForTimeframe(sessions('Y', 1))).toBe(43200);
  });

  it('All → 1 день', () => {
    expect(bucketSecondsForTimeframe({ kind: 'all' })).toBe(86400);
  });

  it('range — ближайшая ступень по числу дней', () => {
    expect(bucketSecondsForTimeframe({ kind: 'range', from: '2026-01-01', to: '2026-01-02', includeWeekends: true })).toBe(30);
    expect(bucketSecondsForTimeframe({ kind: 'range', from: '2026-01-01', to: '2026-01-06', includeWeekends: true })).toBe(300);
    expect(bucketSecondsForTimeframe({ kind: 'range', from: '2026-01-01', to: '2026-06-01', includeWeekends: true })).toBe(43200);
  });

  it('монотонность: бакет не убывает с ростом горизонта', () => {
    const ladder = [
      bucketSecondsForTimeframe(sessions('D', 1)),
      bucketSecondsForTimeframe(sessions('D', 2)),
      bucketSecondsForTimeframe(sessions('W', 1)),
      bucketSecondsForTimeframe(sessions('M', 1)),
      bucketSecondsForTimeframe(sessions('Q', 1)),
      bucketSecondsForTimeframe(sessions('Y', 1)),
      bucketSecondsForTimeframe({ kind: 'all' }),
    ];
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]).toBeGreaterThanOrEqual(ladder[i - 1]);
    }
  });
});
