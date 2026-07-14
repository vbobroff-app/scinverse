import { describe, expect, it } from 'vitest';
import {
  effectiveSegmentEndMs,
  gapIntersectsSegment,
  gapsFromLivenessIntervals,
  intersectMs,
  isBreakGap,
  livenessEndMs,
  resolveGapEndMs,
  segmentRecordedEndMs,
  visibleTradeSpans,
} from './coverageGeometry';
import type { CaptureGapDto, CoverageSegmentDto, LivenessIntervalDto } from './types';

describe('coverageGeometry', () => {
  const windowTo = Date.parse('2026-07-12T18:00:00.000Z');
  const now = Date.parse('2026-07-12T15:30:00.000Z');

  it('resolveGapEndMs: при null to берёт from следующего интервала живости', () => {
    const gap: CaptureGapDto = { from: '2026-07-12T14:42:00.000Z', to: null, cause: 'interrupted' };
    const liveness: LivenessIntervalDto[] = [
      { from: '2026-07-12T10:00:00.000Z', to: '2026-07-12T14:42:00.000Z', open: false, closeReason: 'interrupted' },
      { from: '2026-07-12T15:00:00.000Z', to: '2026-07-12T15:10:00.000Z', open: true, closeReason: null },
    ];
    const end = resolveGapEndMs(gap, liveness, now, windowTo);
    expect(end).toBe(Date.parse('2026-07-12T15:00:00.000Z'));
  });

  it('resolveGapEndMs: не тянет разрыв на новый сегмент после реконнекта', () => {
    const gap: CaptureGapDto = { from: '2026-07-12T14:42:00.000Z', to: null, cause: 'interrupted' };
    const liveness: LivenessIntervalDto[] = [
      { from: '2026-07-12T15:00:00.000Z', to: '2026-07-12T15:10:00.000Z', open: true, closeReason: null },
    ];
    const segFrom = Date.parse('2026-07-12T15:00:00.000Z');
    const segTo = Date.parse('2026-07-12T18:00:00.000Z');
    const end = resolveGapEndMs(gap, liveness, now, windowTo);
    const inter = intersectMs(segFrom, segTo, Date.parse(gap.from), end!);
    expect(inter).toBeNull();
  });

  it('livenessEndMs: открытый интервал до «сейчас», не до конца окна', () => {
    expect(
      livenessEndMs(
        { from: '2026-07-12T15:00:00.000Z', to: '2026-07-12T15:05:00.000Z', open: true, closeReason: null },
        now,
        windowTo,
      ),
    ).toBe(now);
  });

  it('gapsFromLivenessIntervals: два interrupted → один разрыв', () => {
    const intervals: LivenessIntervalDto[] = [
      { from: '2026-07-12T10:00:00.000Z', to: '2026-07-12T14:42:00.000Z', open: false, closeReason: 'interrupted' },
      { from: '2026-07-12T15:00:00.000Z', to: '2026-07-12T15:10:00.000Z', open: true, closeReason: null },
    ];
    const gaps = gapsFromLivenessIntervals(intervals);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].from).toBe('2026-07-12T14:42:00.000Z');
    expect(gaps[0].to).toBe('2026-07-12T15:00:00.000Z');
  });

  it('gapIntersectsSegment: новый сегмент на реконнекте не красится', () => {
    const segFrom = Date.parse('2026-07-12T15:00:00.000Z');
    const segTo = Date.parse('2026-07-12T18:00:00.000Z');
    const inter = gapIntersectsSegment(
      segFrom,
      segTo,
      Date.parse('2026-07-12T14:42:00.000Z'),
      Date.parse('2026-07-12T15:00:00.000Z'),
    );
    expect(inter).toBeNull();
  });

  it('effectiveSegmentEndMs: interrupted тянется до следующей живости', () => {
    const seg: CoverageSegmentDto = {
      segmentId: 1,
      instrumentId: 10,
      sourceId: 1,
      from: '2026-07-12T10:00:00.000Z',
      to: '2026-07-12T12:00:00.000Z',
      tradeCount: 0,
      status: 'interrupted',
      gaps: [],
    };
    const liveness: LivenessIntervalDto[] = [
      { from: '2026-07-12T10:00:00.000Z', to: '2026-07-12T14:42:00.000Z', open: false, closeReason: 'interrupted' },
      { from: '2026-07-12T15:00:00.000Z', to: '2026-07-12T15:10:00.000Z', open: true, closeReason: null },
    ];
    expect(effectiveSegmentEndMs(seg, liveness, now, windowTo)).toBe(Date.parse('2026-07-12T15:00:00.000Z'));
  });

  it('visibleTradeSpans: обрезает хвост бакета после обрыва живости', () => {
    const bucketMs = 30_000;
    const bucketStart = Date.parse('2026-07-12T15:37:00.000Z');
    const liveness: LivenessIntervalDto[] = [
      { from: '2026-07-12T10:00:00.000Z', to: '2026-07-12T15:37:22.000Z', open: false, closeReason: 'server_down' },
    ];
    const spans = visibleTradeSpans(bucketStart, bucketMs, liveness, now, windowTo);
    expect(spans).toHaveLength(1);
    expect(spans[0].from).toBe(bucketStart);
    expect(spans[0].to).toBe(Date.parse('2026-07-12T15:37:22.000Z'));
  });

  it('visibleTradeSpans: бакет целиком в разрыве — не рисуем', () => {
    const bucketMs = 30_000;
    const bucketStart = Date.parse('2026-07-12T15:38:00.000Z');
    const liveness: LivenessIntervalDto[] = [
      { from: '2026-07-12T10:00:00.000Z', to: '2026-07-12T15:37:22.000Z', open: false, closeReason: 'server_down' },
    ];
    expect(visibleTradeSpans(bucketStart, bucketMs, liveness, now, windowTo)).toEqual([]);
  });

  it('isBreakGap: закрытый и открытый разрыв — оба со штриховкой', () => {
    const bounded: CaptureGapDto = {
      from: '2026-07-13T15:03:37.000Z',
      to: '2026-07-13T15:40:51.000Z',
      cause: 'interrupted',
    };
    const ongoing: CaptureGapDto = { from: '2026-07-13T15:03:37.000Z', to: null, cause: 'interrupted' };
    expect(isBreakGap(bounded)).toBe(true);
    expect(isBreakGap(ongoing)).toBe(true);
    expect(isBreakGap({ from: 'x', to: null, cause: 'stopped' })).toBe(false);
  });

  it('segmentRecordedEndMs: шов обрыва на фактическом ended_at, не на реконнекте', () => {
    const seg: CoverageSegmentDto = {
      segmentId: 105,
      instrumentId: 10,
      sourceId: 1,
      from: '2026-07-13T12:11:29.000Z',
      to: '2026-07-13T15:03:37.000Z',
      tradeCount: 1,
      status: 'interrupted',
      gaps: [],
    };
    expect(segmentRecordedEndMs(seg, now, windowTo)).toBe(Date.parse('2026-07-13T15:03:37.000Z'));
  });
});
