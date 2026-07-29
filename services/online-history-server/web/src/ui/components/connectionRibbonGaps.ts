import type { CaptureGapDto } from '../../core/types';

/** Дефолт T, если API не прислал `linkRecoverGraceSeconds` (совпадает с OhsOptions). */
export const DEFAULT_LINK_RECOVER_GRACE_SEC = 60;

/**
 * Момент жёлтое→красное на ленте Connection.
 * T = **максимум** жёлтой фазы (owner TRANSAQ):
 * - `escalatedAt` с бэка (grace или Degraded→Down раньше T) — `t`, где `t ≤ T`;
 * - без маркера на длинном `degraded` — потолок `from+T` (safety).
 * Early fail: `escalatedAt` &lt; from+T → жёлтое короче T.
 */
export function resolveEscalatedMs(
  gap: CaptureGapDto,
  fromMs: number,
  toMs: number,
  graceSec: number = DEFAULT_LINK_RECOVER_GRACE_SEC,
): number | null {
  const graceMs = (graceSec > 0 ? graceSec : DEFAULT_LINK_RECOVER_GRACE_SEC) * 1000;
  const maxEsc = fromMs + graceMs;

  if (gap.escalatedAt) {
    const esc = Date.parse(gap.escalatedAt);
    if (Number.isFinite(esc) && esc > fromMs && esc < toMs) {
      // T — потолок: early Down → t&lt;T; маркер после T не удлиняет жёлтое.
      const t = Math.min(esc, maxEsc);
      return t > fromMs && t < toMs ? t : null;
    }
  }

  if (gap.cause !== 'degraded') {
    return null;
  }

  // Нет маркера: жёлтое не длиннее T.
  if (maxEsc > fromMs && maxEsc < toMs) {
    return maxEsc;
  }

  return null;
}
