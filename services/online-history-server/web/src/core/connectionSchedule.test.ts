import { describe, expect, it } from 'vitest';
import {
  SCHEDULE_TZ_OFFSET_MIN,
  enumerateDesiredWindows,
  formatScheduleIdleTooltip,
  scheduleVoidIntervals,
  scheduleVoidIntervalsOnSessions,
  type ScheduleMsInterval,
} from './connectionSchedule';
import type { ConnectionScheduleRuleDto } from './types';

function rule(partial: Partial<ConnectionScheduleRuleDto> & Pick<ConnectionScheduleRuleDto, 'scopeKind' | 'mode'>): ConnectionScheduleRuleDto {
  return {
    scheduleId: 1,
    connectionId: 1,
    dowMask: null,
    dateFrom: null,
    dateTo: null,
    open: null,
    durationMin: null,
    end: null,
    effectiveFrom: '2020-01-01T00:00:00Z',
    effectiveTo: null,
    closeReason: null,
    changeSource: 'test',
    changeNote: null,
    ...partial,
  };
}

/** MSK wall → UTC ms. */
function msk(y: number, mo: number, d: number, h: number, mi = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi) - SCHEDULE_TZ_OFFSET_MIN * 60_000;
}

describe('scheduleVoidIntervals / enumerateDesiredWindows', () => {
  const main9to18 = rule({
    scopeKind: 'main',
    mode: 'window',
    open: '09:00:00',
    durationMin: 540,
  });

  it('returns empty voids when no live rules', () => {
    expect(scheduleVoidIntervals([], msk(2026, 7, 30, 0), msk(2026, 7, 31, 0))).toEqual([]);
  });

  it('enumerates desired inside a day window', () => {
    const from = msk(2026, 7, 30, 0);
    const to = msk(2026, 7, 31, 0);
    expect(enumerateDesiredWindows([main9to18], from, to)).toEqual([
      { fromMs: msk(2026, 7, 30, 9), toMs: msk(2026, 7, 30, 18) },
    ]);
  });

  it('void is complement of desired (night + evening)', () => {
    const from = msk(2026, 7, 30, 0);
    const to = msk(2026, 7, 31, 0);
    expect(scheduleVoidIntervals([main9to18], from, to)).toEqual([
      { fromMs: from, toMs: msk(2026, 7, 30, 9) },
      { fromMs: msk(2026, 7, 30, 18), toMs: to },
    ]);
  });

  it('overnight session leaves midday void', () => {
    // Fri 22:00 + 240min → Sat 02:00
    const overnight = rule({
      scopeKind: 'dow',
      mode: 'window',
      dowMask: 16, // Friday
      open: '22:00:00',
      durationMin: 240,
    });
    // Range Fri 20:00 – Sat 06:00 MSK
    const from = msk(2026, 7, 31, 20); // Fri
    const to = msk(2026, 8, 1, 6); // Sat
    const desired = enumerateDesiredWindows([overnight], from, to);
    expect(desired).toEqual([{ fromMs: msk(2026, 7, 31, 22), toMs: msk(2026, 8, 1, 2) }]);
    const voids = scheduleVoidIntervals([overnight], from, to);
    expect(voids).toEqual([
      { fromMs: from, toMs: msk(2026, 7, 31, 22) },
      { fromMs: msk(2026, 8, 1, 2), toMs: to },
    ]);
  });

  it('multi-window day yields two voids between sessions when range is full day', () => {
    const morning = rule({
      scopeKind: 'main',
      mode: 'window',
      open: '10:00:00',
      durationMin: 120,
      effectiveFrom: '2020-01-01T00:00:00Z',
    });
    // date override afternoon — higher tier than main
    const afternoon = rule({
      scopeKind: 'date',
      mode: 'window',
      dateFrom: '2026-07-30',
      dateTo: '2026-07-30',
      open: '14:00:00',
      durationMin: 240,
      effectiveFrom: '2020-01-02T00:00:00Z',
    });
    // date wins whole day → only afternoon desired (not union with main)
    const from = msk(2026, 7, 30, 0);
    const to = msk(2026, 7, 31, 0);
    expect(enumerateDesiredWindows([morning, afternoon], from, to)).toEqual([
      { fromMs: msk(2026, 7, 30, 14), toMs: msk(2026, 7, 30, 18) },
    ]);
  });

  it('two main-level windows are not both active — winner only; use two days for multi void', () => {
    const from = msk(2026, 7, 30, 0);
    const to = msk(2026, 8, 1, 0);
    const voids = scheduleVoidIntervals([main9to18], from, to);
    // night30, evening30→morning31 gap is void between 18:00 and next 09:00
    expect(voids).toEqual([
      { fromMs: from, toMs: msk(2026, 7, 30, 9) },
      { fromMs: msk(2026, 7, 30, 18), toMs: msk(2026, 7, 31, 9) },
      { fromMs: msk(2026, 7, 31, 18), toMs: to },
    ] satisfies ScheduleMsInterval[]);
  });

  it('formatScheduleIdleTooltip uses schedule TZ wall clock', () => {
    expect(formatScheduleIdleTooltip(msk(2026, 7, 30, 1), msk(2026, 7, 30, 6, 50))).toBe(
      'Окно простоя 01:00 – 06:50',
    );
  });

  it('OnSessions: voids include tomorrow slot (D+ horizon)', () => {
    // Сегодня + завтра как две доли оси (как D2 + D+).
    const sessions = [
      {
        start: new Date(msk(2026, 7, 30, 8, 50)).toISOString(),
        end: new Date(msk(2026, 7, 30, 23, 50)).toISOString(),
      },
      {
        start: new Date(msk(2026, 7, 31, 8, 50)).toISOString(),
        end: new Date(msk(2026, 7, 31, 23, 50)).toISOString(),
      },
    ];
    const voids = scheduleVoidIntervalsOnSessions([main9to18], sessions);
    // На завтрашней доле — вечерний простой после 18:00.
    expect(voids).toContainEqual({
      fromMs: msk(2026, 7, 31, 18),
      toMs: msk(2026, 7, 31, 23, 50),
    });
    // И утренний до 09:00 на завтра.
    expect(voids).toContainEqual({
      fromMs: msk(2026, 7, 31, 8, 50),
      toMs: msk(2026, 7, 31, 9),
    });
  });
});
