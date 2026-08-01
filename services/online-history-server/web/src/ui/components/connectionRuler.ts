import { tzDateOf } from '../../core/moexSession';
import { makeInverseProjector, makeProjector } from '../../core/sessionProjection';
import type { SessionDto } from '../../core/types';

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

/** Целевое число major-делений окна (0–24ч → 12 × 2ч). */
const MAJOR_TARGET = 12;
/** Каждая major-доля делится на столько minor. */
const MINORS_PER_MAJOR = 4;
/** Минимальный визуальный шаг major (px); иначе берём следующий «красивый» шаг. */
const MIN_MAJOR_PX = 28;
/** Магнит к major-тику (px). */
const MAJOR_SNAP_PX = 2;

/**
 * «Красивые» major-шаги: major/4 даёт ровный minor
 * (1ч→15м, 2ч→30м, 4ч→1ч, 12ч→3ч, 1д→6ч, …).
 */
const NICE_MAJOR_MS: readonly number[] = [
  HOUR_MS,
  2 * HOUR_MS,
  4 * HOUR_MS,
  12 * HOUR_MS,
  DAY_MS,
  2 * DAY_MS,
  4 * DAY_MS,
  8 * DAY_MS,
  28 * DAY_MS,
];

export interface RulerTick {
  left: number;
  major: boolean;
  title: string;
}

export interface RulerHover {
  /** Время после квантования ~1px и магнита к major. */
  ms: number;
  label: string;
  /** Примагнитились к major. */
  snappedMajor: boolean;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function hhmm(ms: number, offMin: number): string {
  const d = new Date(ms + offMin * 60_000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function tickTitle(ms: number, offMin: number, withDate: boolean): string {
  const time = hhmm(ms, offMin);
  if (!withDate) {
    return time;
  }
  const d = tzDateOf(ms, offMin);
  return `${pad2(d.day)}.${pad2(d.month)} ${time}`;
}

/** Наименьший «красивый» major ≈ span/12; при узкой ширине — укрупняем. */
export function pickMajorMs(spanMs: number, widthPx: number): number {
  let major = NICE_MAJOR_MS[NICE_MAJOR_MS.length - 1];
  for (const step of NICE_MAJOR_MS) {
    if (spanMs / step <= MAJOR_TARGET) {
      major = step;
      break;
    }
  }
  if (widthPx > 0) {
    for (const step of NICE_MAJOR_MS) {
      if (step < major) continue;
      const count = Math.max(1, spanMs / step);
      if (widthPx / count >= MIN_MAJOR_PX) {
        return step;
      }
    }
  }
  return major;
}

/**
 * Линейка по кратному времени: ~12 major на окно, каждая major → 4 minor.
 * Пример: 0–24ч → major каждые 2ч, minor каждые 30м. Позиция — через projector оси.
 */
export function buildRulerTicks(
  widthPx: number,
  fromMs: number,
  toMs: number,
  sessions: SessionDto[] | undefined,
  tzOffsetMin: number,
): RulerTick[] {
  const span = Math.max(1, toMs - fromMs);
  const majorMs = pickMajorMs(span, widthPx);
  const minorMs = majorMs / MINORS_PER_MAJOR;
  const pct = makeProjector(fromMs, toMs, sessions);
  const off = tzOffsetMin * 60_000;
  const withDate = span > 36 * HOUR_MS || (sessions?.length ?? 0) > 1;

  const firstShifted = Math.ceil((fromMs + off) / minorMs) * minorMs;
  const lastShifted = Math.floor((toMs + off) / minorMs) * minorMs;
  const out: RulerTick[] = [];

  for (let shifted = firstShifted; shifted <= lastShifted; shifted += minorMs) {
    const t = shifted - off;
    const left = pct(t);
    const major = shifted % majorMs === 0;
    const title = tickTitle(t, tzOffsetMin, withDate);
    const prev = out[out.length - 1];
    // Ночные разрывы схлопнуты: несколько времён → одна точка — оставляем major, если есть.
    if (prev && Math.abs(prev.left - left) < 0.08) {
      if (major && !prev.major) {
        out[out.length - 1] = { left, major: true, title };
      }
      continue;
    }
    out.push({ left, major, title });
  }
  return out;
}

/**
 * Время под курсором на линейке: квант ~1px + магнит к ближайшему major-тику.
 * `leftPct` — 0..100 по ширине линейки.
 */
export function resolveRulerHover(
  leftPct: number,
  widthPx: number,
  fromMs: number,
  toMs: number,
  sessions: SessionDto[] | undefined,
  tzOffsetMin: number,
): RulerHover {
  return makeRulerHoverResolver(fromMs, toMs, sessions, tzOffsetMin, widthPx)(leftPct);
}

/**
 * Кэшируемый резолвер для scrub/hover: projectors и majorMs собираются один раз
 * на смену окна/ширины, а не на каждый mousemove.
 */
export function makeRulerHoverResolver(
  fromMs: number,
  toMs: number,
  sessions: SessionDto[] | undefined,
  tzOffsetMin: number,
  widthPx: number,
): (leftPct: number) => RulerHover {
  const span = Math.max(1, toMs - fromMs);
  const w = Math.max(1, widthPx);
  const majorMs = pickMajorMs(span, w);
  const inv = makeInverseProjector(fromMs, toMs, sessions);
  const pct = makeProjector(fromMs, toMs, sessions);
  const withDate = span > 36 * HOUR_MS || (sessions?.length ?? 0) > 1;
  const off = tzOffsetMin * 60_000;
  const pxToPct = 100 / w;

  return (leftPct: number): RulerHover => {
    const qPct = Math.min(100, Math.max(0, Math.round(leftPct / pxToPct) * pxToPct));
    let ms = inv(qPct);
    let snappedMajor = false;

    const nearestMajorShifted = Math.round((ms + off) / majorMs) * majorMs;
    const majorT = nearestMajorShifted - off;
    if (majorT >= fromMs - 1 && majorT <= toMs + 1) {
      const majorLeft = pct(majorT);
      const distPx = (Math.abs(majorLeft - qPct) / 100) * w;
      if (distPx <= MAJOR_SNAP_PX) {
        ms = Math.min(toMs, Math.max(fromMs, majorT));
        snappedMajor = true;
      }
    }

    return { ms, label: tickTitle(ms, tzOffsetMin, withDate), snappedMajor };
  };
}

/**
 * Таблица label по X-пикселю линейки (0..width-1) — hot-path scrub без вызова projector.
 */
export function buildRulerLabelLut(
  widthPx: number,
  resolve: (leftPct: number) => RulerHover,
): string[] {
  const w = Math.max(1, Math.floor(widthPx));
  const out = new Array<string>(w);
  for (let x = 0; x < w; x++) {
    out[x] = resolve((x / w) * 100).label;
  }
  return out;
}
