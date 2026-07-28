export const DAY_MIN = 24 * 60;
export const AXIS_MIN = 48 * 60;
/** Окно соединения ≤ одних суток (duration). */
export const MAX_SPAN_MIN = DAY_MIN;
/**
 * Сессия: open только сегодня, close сегодня|завтра.
 * Hard frame: start ∈ [00:00 today, 24:00 today), end ≤ 24:00 tomorrow.
 */
export const OPEN_LO = 0;
export const OPEN_HI = DAY_MIN;
export const HORIZON_HI = AXIS_MIN;
export const SNAP = 5;
/** @deprecated alias — сессия не уходит во вчера; open ≥ 00:00 today. */
export const HORIZON_LO = OPEN_LO;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function snapMin(m: number): number {
  return Math.round(m / SNAP) * SNAP;
}

function maxOpenMin(): number {
  return OPEN_HI - SNAP;
}

function fmtClock(totalMin: number): string {
  const m = ((totalMin % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Шаблон open/close + pad → start/end от полуночи сегодня.
 * null, если duration >24ч, open не сегодня, или open уходит во вчера (pad слишком большой).
 */
export function templateToAxisMins(
  openH: number,
  openM: number,
  closeH: number,
  closeM: number,
  padHours: number,
  minSpanMin = 60,
): { startMin: number; endMin: number } | null {
  const startMin = snapMin(openH * 60 + openM - padHours * 60);
  const endMin = snapMin(closeH * 60 + closeM + padHours * 60);
  const span = endMin - startMin;
  if (span < minSpanMin || span > MAX_SPAN_MIN || endMin <= startMin) {
    return null;
  }
  if (startMin < OPEN_LO || startMin >= OPEN_HI) {
    return null;
  }
  if (endMin > HORIZON_HI) {
    return null;
  }
  return { startMin, endMin };
}

/** HH:mm → минуты 0..1439. */
export function parseHmToMin(hhmm: string): number {
  const [hh, mm] = hhmm.split(':').map((x) => Number(x));
  return (hh || 0) * 60 + (mm || 0);
}

/** Минуты → HH:mm в пределах суток. */
export function fmtMinToHm(total: number): string {
  return fmtClock(total);
}

/**
 * Из API-окон HH:mm → минуты от полуночи сегодня (overnight: end уезжает во «завтра»).
 * Open зажимается в сегодня.
 */
export function windowToAxisMins(startHm: string, endHm: string): { startMin: number; endMin: number } {
  let startMin = snapMin(parseHmToMin(startHm));
  let endMin = snapMin(parseHmToMin(endHm));
  if (endMin <= startMin) {
    endMin += DAY_MIN;
  }
  startMin = clamp(startMin, OPEN_LO, maxOpenMin());
  endMin = clamp(endMin, startMin + SNAP, Math.min(HORIZON_HI, startMin + MAX_SPAN_MIN));
  return { startMin, endMin };
}

/** Абсолютные минуты → пара HH:mm для API. */
export function axisMinsToWindow(startMin: number, endMin: number): { start: string; end: string } {
  return {
    start: fmtMinToHm(startMin),
    end: fmtMinToHm(endMin),
  };
}
