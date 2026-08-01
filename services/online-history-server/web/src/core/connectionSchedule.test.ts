import { describe, expect, it } from 'vitest';
import {
  SCHEDULE_TZ_OFFSET_MIN,
  buildScheduleDesiredSegs,
  buildScheduleMaskSegs,
  enumerateDesiredWindows,
  formatScheduleDesiredTooltip,
  formatScheduleIdleTooltip,
  projectScheduleMaskSegs,
  scheduleVoidIntervals,
  scheduleVoidIntervalsOnSessions,
  type ScheduleMsInterval,
} from './connectionSchedule';
import { makeProjector } from './sessionProjection';
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
    expect(formatScheduleDesiredTooltip(msk(2026, 7, 30, 6), msk(2026, 7, 31, 1))).toBe(
      'Окно расписания 06:00 – 01:00',
    );
  });

  it('buildScheduleDesiredSegs: tip keeps full overnight window', () => {
    const rules = [
      rule({
        scopeKind: 'main',
        mode: 'window',
        open: '06:00:00',
        durationMin: 19 * 60,
        effectiveFrom: '2020-01-01T00:00:00Z',
      }),
    ];
    const sessions = [
      {
        date: '2026-07-31',
        start: new Date(msk(2026, 7, 31, 8, 50)).toISOString(),
        end: new Date(msk(2026, 7, 31, 23, 50)).toISOString(),
      },
    ];
    const pct = makeProjector(
      Date.parse(sessions[0]!.start),
      Date.parse(sessions[0]!.end),
      sessions,
    );
    const segs = buildScheduleDesiredSegs(rules, sessions, pct);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    const overnight = segs.find((s) => s.fromMs === msk(2026, 7, 31, 6));
    expect(overnight).toMatchObject({
      fromMs: msk(2026, 7, 31, 6),
      toMs: msk(2026, 8, 1, 1),
    });
    expect(overnight!.widthPct).toBeGreaterThan(5);
  });

  it('OnSessions: schedule 08:50–20:00 + overnight → void 01:00–08:50 tomorrow', () => {
    // Ось может быть MOEX-слотами — на void это не влияет, только connection schedule.
    const sessions = [
      {
        date: '2026-07-30',
        start: new Date(msk(2026, 7, 30, 8, 50)).toISOString(),
        end: new Date(msk(2026, 7, 30, 23, 50)).toISOString(),
      },
      {
        date: '2026-07-31',
        start: new Date(msk(2026, 7, 31, 8, 50)).toISOString(),
        end: new Date(msk(2026, 7, 31, 23, 50)).toISOString(),
      },
    ];
    // Рабочее окно 08:50–20:00 (= 670 мин); хвост с вчера до 01:00 — отдельное overnight-правило.
    const dayWindow = rule({
      scopeKind: 'main',
      mode: 'window',
      open: '08:50:00',
      durationMin: 670,
      effectiveFrom: '2020-01-01T00:00:00Z',
    });
    // Вчера 10:00 + 15ч → сегодня 01:00 (для 30-го open day).
    const overnight = rule({
      scopeKind: 'date',
      mode: 'window',
      dateFrom: '2026-07-30',
      dateTo: '2026-07-30',
      open: '10:00:00',
      durationMin: 15 * 60,
      effectiveFrom: '2020-01-02T00:00:00Z',
    });
    const voids = scheduleVoidIntervalsOnSessions([dayWindow, overnight], sessions);
    expect(voids).toContainEqual({
      fromMs: msk(2026, 7, 31, 1),
      toMs: msk(2026, 7, 31, 8, 50),
    });
  });

  it('D+: today void 01:00–06:00 and tomorrow void 01:00–08:50 both paint', () => {
    // main: 06:00 + 19ч → до 01:00 следующего дня; завтра date: 08:50–20:00.
    const rules = [
      rule({
        scopeKind: 'main',
        mode: 'window',
        open: '06:00:00',
        durationMin: 19 * 60,
        effectiveFrom: '2020-01-01T00:00:00Z',
      }),
      rule({
        scopeKind: 'date',
        mode: 'window',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-01',
        open: '08:50:00',
        durationMin: 670,
        effectiveFrom: '2020-01-02T00:00:00Z',
      }),
    ];
    const sessions = [
      {
        date: '2026-07-31',
        start: new Date(msk(2026, 7, 31, 8, 50)).toISOString(),
        end: new Date(msk(2026, 7, 31, 23, 50)).toISOString(),
      },
      {
        date: '2026-08-01',
        start: new Date(msk(2026, 8, 1, 8, 50)).toISOString(),
        end: new Date(msk(2026, 8, 1, 23, 50)).toISOString(),
      },
    ];
    const pct = makeProjector(
      Date.parse(sessions[0]!.start),
      Date.parse(sessions[1]!.end),
      sessions,
    );
    const segs = buildScheduleMaskSegs(rules, sessions, pct);
    expect(segs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromMs: msk(2026, 7, 31, 1),
          toMs: msk(2026, 7, 31, 6),
        }),
        expect.objectContaining({
          fromMs: msk(2026, 8, 1, 1),
          toMs: msk(2026, 8, 1, 8, 50),
          leftPct: expect.any(Number),
          widthPct: expect.any(Number),
        }),
      ]),
    );
    const tom = segs.find((s) => s.fromMs === msk(2026, 8, 1, 1));
    expect(tom!.widthPct).toBeGreaterThan(5);
    expect(tom!.leftPct).toBeGreaterThan(40);
  });

  it('projectScheduleMaskSegs: maps calendar void 01:00–08:50 onto day column', () => {
    const session = {
      date: '2026-07-31',
      start: new Date(msk(2026, 7, 31, 8, 50)).toISOString(),
      end: new Date(msk(2026, 7, 31, 23, 50)).toISOString(),
    };
    const pct = makeProjector(
      msk(2026, 7, 30, 8, 50),
      msk(2026, 7, 31, 23, 50),
      [
        {
          date: '2026-07-30',
          start: new Date(msk(2026, 7, 30, 8, 50)).toISOString(),
          end: new Date(msk(2026, 7, 30, 23, 50)).toISOString(),
        },
        session,
      ],
    );
    // Ось схлопывает 01:00–08:50 в шов.
    expect(pct(msk(2026, 7, 31, 8, 50)) - pct(msk(2026, 7, 31, 1))).toBe(0);

    const segs = projectScheduleMaskSegs(
      [{ fromMs: msk(2026, 7, 31, 1), toMs: msk(2026, 7, 31, 8, 50) }],
      session,
      pct,
    );
    expect(segs).toHaveLength(1);
    // ~7h50 / 24ч доли колонки.
    expect(segs[0]!.widthPct).toBeGreaterThan(10);
    expect(segs[0]!.fromMs).toBe(msk(2026, 7, 31, 1));
    expect(segs[0]!.toMs).toBe(msk(2026, 7, 31, 8, 50));
  });
});
