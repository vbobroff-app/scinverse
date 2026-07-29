import { describe, expect, it } from 'vitest';
import type { CaptureGapDto } from '../../core/types';
import { DEFAULT_LINK_RECOVER_GRACE_SEC, resolveEscalatedMs } from './connectionRibbonGaps';

describe('resolveEscalatedMs', () => {
  const from = Date.parse('2026-07-28T06:44:49.000Z');
  const to = Date.parse('2026-07-28T07:17:04.000Z');

  it('uses escalatedAt from API when early fail t < T', () => {
    const esc = new Date(from + 41_000).toISOString();
    const gap: CaptureGapDto = {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      cause: 'degraded',
      escalatedAt: esc,
    };
    expect(resolveEscalatedMs(gap, from, to, 60)).toBe(from + 41_000);
  });

  it('caps escalatedAt at T when marker is past grace', () => {
    const gap: CaptureGapDto = {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      cause: 'degraded',
      escalatedAt: new Date(from + 90_000).toISOString(),
    };
    expect(resolveEscalatedMs(gap, from, to, 60)).toBe(from + 60_000);
  });

  it('clamps degraded gap without marker to from+T', () => {
    const gap: CaptureGapDto = {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      cause: 'degraded',
    };
    expect(resolveEscalatedMs(gap, from, to, DEFAULT_LINK_RECOVER_GRACE_SEC)).toBe(
      from + DEFAULT_LINK_RECOVER_GRACE_SEC * 1000,
    );
  });

  it('does not invent escalation for server_down', () => {
    const gap: CaptureGapDto = {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      cause: 'server_down',
    };
    expect(resolveEscalatedMs(gap, from, to, 60)).toBeNull();
  });

  it('ignores escalatedAt outside gap and still clamps degraded', () => {
    const gap: CaptureGapDto = {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      cause: 'degraded',
      escalatedAt: new Date(to + 1_000).toISOString(),
    };
    expect(resolveEscalatedMs(gap, from, to, 60)).toBe(from + 60_000);
  });

  it('no clamp when degraded gap shorter than T', () => {
    const shortTo = from + 30_000;
    const gap: CaptureGapDto = {
      from: new Date(from).toISOString(),
      to: new Date(shortTo).toISOString(),
      cause: 'degraded',
    };
    expect(resolveEscalatedMs(gap, from, shortTo, 60)).toBeNull();
  });
});
