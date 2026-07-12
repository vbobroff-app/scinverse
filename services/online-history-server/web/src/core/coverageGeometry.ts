import type { CaptureGapDto, CoverageSegmentDto, LivenessIntervalDto } from './types';

/** Пересечение двух полуинтервалов [a0,a1) ∩ [b0,b1) в ms; null если пусто. */
export function intersectMs(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): { from: number; to: number } | null {
  const from = Math.max(a0, b0);
  const to = Math.min(a1, b1);
  return from < to ? { from, to } : null;
}

/** Правый край интервала живости: открытый — до «сейчас», не до конца окна сессии. */
export function livenessEndMs(liv: LivenessIntervalDto, nowMs: number, windowToMs: number): number {
  return liv.open ? Math.min(nowMs, windowToMs) : Date.parse(liv.to);
}

const BREAK_CAUSES = new Set(['server_down', 'ping_failed', 'interrupted']);

/** Разрыв захвата с известной причиной (не «stopped»). */
export function isBreakGap(gap: CaptureGapDto): boolean {
  return BREAK_CAUSES.has(gap.cause);
}

export function isBreakCloseReason(reason: string | null | undefined): boolean {
  return reason != null && BREAK_CAUSES.has(reason);
}

/** Журнал разрывов из интервалов живости (надёжнее, чем только gaps с API). */
export function gapsFromLivenessIntervals(
  intervals: readonly LivenessIntervalDto[],
): CaptureGapDto[] {
  const sorted = [...intervals].sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  const gaps: CaptureGapDto[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur.open || !isBreakCloseReason(cur.closeReason)) {
      continue;
    }
    const next = sorted[i + 1];
    gaps.push({
      from: cur.to,
      to: next ? next.from : null,
      cause: cur.closeReason!,
    });
  }
  return gaps;
}

/**
 * Для `interrupted`: визуально тянем правый край намерения до heartbeat живости
 * (recovery в БД мог закрыть сегмент по последней сделке, раньше обрыва).
 */
export function effectiveSegmentEndMs(
  seg: CoverageSegmentDto,
  livenessIntervals: readonly LivenessIntervalDto[] | undefined,
  nowMs: number,
  windowToMs: number,
): number {
  const liveEdge = Math.min(nowMs, windowToMs);
  const recorded = seg.to ? Date.parse(seg.to) : liveEdge;
  if (seg.status !== 'interrupted' || !livenessIntervals?.length) {
    return recorded;
  }

  const segFrom = Date.parse(seg.from);
  let end = recorded;
  let nextLivStart: number | undefined;

  for (const liv of livenessIntervals) {
    const livFrom = Date.parse(liv.from);
    if (livFrom > segFrom) {
      nextLivStart = nextLivStart === undefined ? livFrom : Math.min(nextLivStart, livFrom);
    }
    if (liv.open || !isBreakCloseReason(liv.closeReason)) {
      continue;
    }
    const livTo = Date.parse(liv.to);
    if (segFrom <= livTo) {
      end = Math.max(end, livTo);
    }
  }

  // Запись оставалась «включённой» (осиротевший open) до recovery/реконнекта — тянем намерение
  // через красный разрыв до начала следующей живости.
  if (seg.status === 'interrupted' && nextLivStart !== undefined) {
    end = Math.max(end, nextLivStart);
  }

  return end;
}

/** Объединённый span намерения по всем сегментам дорожки (для красных разрывов). */
export function intentSpanForGaps(
  segments: readonly CoverageSegmentDto[],
  livenessIntervals: readonly LivenessIntervalDto[] | undefined,
  nowMs: number,
  windowToMs: number,
): { from: number; to: number } | null {
  if (segments.length === 0) {
    return null;
  }

  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const seg of segments) {
    from = Math.min(from, Date.parse(seg.from));
    to = Math.max(to, effectiveSegmentEndMs(seg, livenessIntervals, nowMs, windowToMs));
  }
  return from < to ? { from, to } : null;
}

/**
 * Конец разрыва: если бэк не знает `to` (разрыв ещё длится), но уже есть следующий
 * интервал живости — берём его `from`, иначе не тянем красную полосу за реконнект.
 */
export function resolveGapEndMs(
  gap: CaptureGapDto,
  livenessIntervals: readonly LivenessIntervalDto[] | undefined,
  nowMs: number,
  windowToMs: number,
): number | null {
  if (gap.to) {
    return Date.parse(gap.to);
  }

  const gapFromMs = Date.parse(gap.from);
  const nextLivStart = livenessIntervals
    ?.map((l) => Date.parse(l.from))
    .filter((f) => f > gapFromMs)
    .sort((a, b) => a - b)[0];

  if (nextLivStart !== undefined) {
    return nextLivStart;
  }

  // Разрыв ещё идёт — до «сейчас», не до конца окна.
  return Math.min(nowMs, windowToMs);
}

/** Сегмент, начавшийся на/после конца разрыва, не должен краситься (шов на реконнекте). */
export function gapIntersectsSegment(
  segFromMs: number,
  segToMs: number,
  gapFromMs: number,
  gapEndMs: number,
): { from: number; to: number } | null {
  if (segFromMs >= gapEndMs) {
    return null;
  }
  return intersectMs(segFromMs, segToMs, gapFromMs, gapEndMs);
}
