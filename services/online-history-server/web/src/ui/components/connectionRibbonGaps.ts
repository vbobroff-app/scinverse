import type { CaptureGapDto } from '../../core/types';

/**
 * Момент жёлтое→красное: только `escalatedAt` с бэка (маркер handover в `link_liveness`).
 * Без маркера — одна фаза по `cause` (не изобретаем from+60с).
 */
export function resolveEscalatedMs(
  gap: CaptureGapDto,
  fromMs: number,
  toMs: number,
): number | null {
  if (!gap.escalatedAt) {
    return null;
  }
  const esc = Date.parse(gap.escalatedAt);
  if (Number.isFinite(esc) && esc > fromMs && esc < toMs) {
    return esc;
  }
  return null;
}
