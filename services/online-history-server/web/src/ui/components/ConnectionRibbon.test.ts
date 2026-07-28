import { describe, expect, it } from 'vitest';
import type { CaptureGapDto } from '../../core/types';
import { resolveEscalatedMs } from './ConnectionRibbon';

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

  it('caps degraded without marker at 60s yellow', () => {
    const gap: CaptureGapDto = {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      cause: 'degraded',
    };
    expect(resolveEscalatedMs(gap, from, to)).toBe(from + 60_000);
  });

  it('does not invent escalation for server_down', () => {
    const gap: CaptureGapDto = {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      cause: 'server_down',
    };
    expect(resolveEscalatedMs(gap, from, to)).toBeNull();
  });

  it('no split when degraded shorter than yellow max', () => {
    const shortTo = from + 30_000;
    const gap: CaptureGapDto = {
      from: new Date(from).toISOString(),
      to: new Date(shortTo).toISOString(),
      cause: 'degraded',
    };
    expect(resolveEscalatedMs(gap, from, shortTo)).toBeNull();
  });
});
