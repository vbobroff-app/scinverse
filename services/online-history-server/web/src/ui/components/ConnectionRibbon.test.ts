import { describe, expect, it } from 'vitest';
import type { CaptureGapDto } from '../../core/types';
import { resolveEscalatedMs } from './connectionRibbonGaps';

describe('resolveEscalatedMs', () => {
  const from = Date.parse('2026-07-28T06:44:49.000Z');
  const to = Date.parse('2026-07-28T07:17:04.000Z');

  it('uses escalatedAt from API when inside gap', () => {
    const esc = new Date(from + 41_000).toISOString();
    const gap: CaptureGapDto = {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      cause: 'degraded',
      escalatedAt: esc,
    };
    expect(resolveEscalatedMs(gap, from, to)).toBe(from + 41_000);
  });

  it('does not invent escalation without marker', () => {
    const gap: CaptureGapDto = {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      cause: 'degraded',
    };
    expect(resolveEscalatedMs(gap, from, to)).toBeNull();
  });

  it('does not invent escalation for server_down', () => {
    const gap: CaptureGapDto = {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      cause: 'server_down',
    };
    expect(resolveEscalatedMs(gap, from, to)).toBeNull();
  });

  it('ignores escalatedAt outside gap', () => {
    const gap: CaptureGapDto = {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      cause: 'degraded',
      escalatedAt: new Date(to + 1_000).toISOString(),
    };
    expect(resolveEscalatedMs(gap, from, to)).toBeNull();
  });
});
