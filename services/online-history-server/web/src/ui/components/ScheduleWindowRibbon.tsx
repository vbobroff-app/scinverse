import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import styles from './ScheduleWindowRibbon.module.css';

const DAY_MIN = 24 * 60;
const AXIS_MIN = 48 * 60;
/** Окно соединения ≤ одних суток (duration). */
const MAX_SPAN_MIN = DAY_MIN;
/**
 * Сессия: open только сегодня, close сегодня|завтра.
 * Hard frame: start ∈ [00:00 today, 24:00 today), end ≤ 24:00 tomorrow.
 */
const OPEN_LO = 0;
const OPEN_HI = DAY_MIN;
const HORIZON_HI = AXIS_MIN;
const SNAP = 5;
/** Peek вчера при упоре в 00:00 today (без постановки маркеров во вчера). */
const OVERSCROLL_PEEK = 40;
const PEEK_MAX = 0.18;
const SLIDE_MS = 340;

/** Постановка всегда на today|tomorrow; slide>0 — только визуальный peek вчера. */
export type ScheduleViewDay = 0;

export interface ScheduleWindowRibbonProps {
  /**
   * Абсолютные минуты от полуночи сегодня.
   * start ∈ [0 .. 24h), end ∈ (start .. start+24h] ∩ ≤48h.
   */
  startMin: number;
  endMin: number;
  onChange: (startMin: number, endMin: number) => void;
  /** Как тумблер «Подсвечивать дни» на Ганте. */
  highlightDays?: boolean;
  /** Режим просмотра — маркеры не двигаются. */
  readOnly?: boolean;
  /** Base-диапазон шаблона (без shift) — чуть светлее внутри окна. */
  baseStartMin?: number | null;
  baseEndMin?: number | null;
  /** Справа в строке «сегодня / завтра», без лишней высоты. */
  durationLabel?: string | null;
  /** Режим «выключено»: штриховка только текущих суток (0..24ч), без окна. */
  off?: boolean;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function snapMin(m: number): number {
  return Math.round(m / SNAP) * SNAP;
}

/** Макс. старт (открытие только сегодня). */
function maxOpenMin(): number {
  return OPEN_HI - SNAP;
}

function dayTitle(dayAbs: number): string {
  if (dayAbs === -1) {
    return 'вчера';
  }
  if (dayAbs === 0) {
    return 'сегодня';
  }
  if (dayAbs === 1) {
    return 'завтра';
  }
  return `день ${dayAbs}`;
}

function fmtClock(totalMin: number): string {
  const m = ((totalMin % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Пересечение окна с календарными сутками dayAbs (−1|0|1) → `06:05–24:00` или null. */
function dayRangeLabel(dayAbs: number, startMin: number, endMin: number): string | null {
  const dayLo = dayAbs * DAY_MIN;
  const dayHi = dayLo + DAY_MIN;
  const lo = Math.max(startMin, dayLo);
  const hi = Math.min(endMin, dayHi);
  if (hi <= lo) {
    return null;
  }
  const fmtEdge = (abs: number, isEnd: boolean): string => {
    const local = abs - dayLo;
    if (isEnd && local >= DAY_MIN) {
      return '24:00';
    }
    if (!isEnd && local <= 0) {
      return '00:00';
    }
    return fmtClock(abs);
  };
  return `${fmtEdge(lo, false)}–${fmtEdge(hi, true)}`;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

type MoveDrag = {
  kind: 'move';
  originClientX: number;
  originStart: number;
  span: number;
  overscroll: number;
};

type EdgeDrag = { kind: 'start' | 'end' };

/**
 * Редактор окна: ось today|tomorrow, peek вчера без постановки.
 * Модель start + duration→end: open сегодня, close сегодня|завтра, duration ≤24ч.
 */
export function ScheduleWindowRibbon({
  startMin,
  endMin,
  onChange,
  highlightDays = false,
  readOnly = false,
  baseStartMin = null,
  baseEndMin = null,
  durationLabel = null,
  off = false,
}: ScheduleWindowRibbonProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<MoveDrag | EdgeDrag | null>(null);
  const startMinRef = useRef(startMin);
  const endMinRef = useRef(endMin);
  startMinRef.current = startMin;
  endMinRef.current = endMin;

  /** 0 = today-tomorrow; >0 = peek вчера (без commit). */
  const [slide, setSlide] = useState(0);
  const slideRef = useRef(0);
  const animRef = useRef<number | null>(null);
  const slidingRef = useRef(false);

  const displayOrigin = -slide * DAY_MIN;
  const stripShiftPct = -((1 - slide) * (100 / 3));

  const absToPct = (abs: number) => ((abs - displayOrigin) / AXIS_MIN) * 100;

  const startPct = absToPct(startMin);
  const endPct = absToPct(endMin);
  const widthPct = Math.max(0, endPct - startPct);
  const labelsCrowded = endPct - startPct < 10;

  // Подписи: при peek чуть «вчера|сегодня», иначе сегодня|завтра.
  const labelLeftDay = slide >= PEEK_MAX * 0.6 ? -1 : 0;
  const labelRightDay = labelLeftDay + 1;

  const animateSlideTo = useCallback((target: number, onDone?: () => void) => {
    if (animRef.current != null) {
      cancelAnimationFrame(animRef.current);
    }
    slidingRef.current = true;
    const from = slideRef.current;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = clamp((now - t0) / SLIDE_MS, 0, 1);
      const next = from + (target - from) * easeOutCubic(t);
      slideRef.current = next;
      setSlide(next);
      if (t < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        animRef.current = null;
        slideRef.current = target;
        setSlide(target);
        slidingRef.current = false;
        onDone?.();
      }
    };
    animRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(
    () => () => {
      if (animRef.current != null) {
        cancelAnimationFrame(animRef.current);
      }
    },
    [],
  );

  const clientXToDeltaMin = useCallback((clientX: number, originClientX: number): number => {
    const el = trackRef.current;
    if (!el) {
      return 0;
    }
    const rect = el.getBoundingClientRect();
    return ((clientX - originClientX) / Math.max(1, rect.width)) * AXIS_MIN;
  }, []);

  const clientXToAbs = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) {
        return displayOrigin;
      }
      const rect = el.getBoundingClientRect();
      const x = clamp(clientX - rect.left, 0, rect.width);
      return displayOrigin + (x / Math.max(1, rect.width)) * AXIS_MIN;
    },
    [displayOrigin],
  );

  const onEdgePointerDown = (which: 'start' | 'end') => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (readOnly || slidingRef.current) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { kind: which };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onRangePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (readOnly || slidingRef.current) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    // preventDefault снимает native-focus — берём явно, чтобы ←/→ работали после drag.
    e.currentTarget.focus({ preventScroll: true });
    const span = endMin - startMin;
    if (span < SNAP) {
      return;
    }
    dragRef.current = {
      kind: 'move',
      originClientX: e.clientX,
      originStart: startMin,
      span,
      overscroll: 0,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const nudgeRange = (deltaMin: number) => {
    if (readOnly || off) return;
    const span = endMin - startMin;
    if (span < SNAP) return;
    const maxStart = Math.min(maxOpenMin(), HORIZON_HI - span);
    const next = clamp(snapMin(startMin + deltaMin), OPEN_LO, maxStart);
    if (next === startMin) return;
    onChange(next, next + span);
  };

  const onRangeKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (readOnly || off) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      nudgeRange(-SNAP);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      nudgeRange(SNAP);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (readOnly || !drag || slidingRef.current) {
      return;
    }

    if (drag.kind === 'move') {
      const rawDelta = clientXToDeltaMin(e.clientX, drag.originClientX);
      const delta = snapMin(rawDelta);
      let desired = drag.originStart + delta;
      const span = drag.span;
      // start только сегодня; end упирается в 24:00 tomorrow / span.
      const maxStart = Math.min(maxOpenMin(), HORIZON_HI - span);

      if (desired <= OPEN_LO) {
        onChange(OPEN_LO, OPEN_LO + span);
        drag.overscroll = -desired;
        const peek = clamp(drag.overscroll / OVERSCROLL_PEEK, 0, 1) * PEEK_MAX;
        slideRef.current = peek;
        setSlide(peek);
        // Вчера только peek — маркеры во вчера не ставим.
        return;
      }
      drag.overscroll = 0;
      if (slideRef.current > 0) {
        slideRef.current = 0;
        setSlide(0);
      }
      desired = clamp(desired, OPEN_LO, maxStart);
      onChange(desired, desired + span);
      return;
    }

    const m = snapMin(clientXToAbs(e.clientX));
    const s = startMinRef.current;
    const en = endMinRef.current;
    if (drag.kind === 'start') {
      onChange(
        clamp(m, Math.max(OPEN_LO, en - MAX_SPAN_MIN), Math.min(en - SNAP, maxOpenMin())),
        en,
      );
    } else {
      onChange(s, clamp(m, s + SNAP, Math.min(HORIZON_HI, s + MAX_SPAN_MIN)));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) {
      return;
    }
    // Peek вчера → пружина обратно к today|tomorrow.
    if (dragRef.current.kind === 'move' && !slidingRef.current && slideRef.current > 0.001) {
      animateSlideTo(0);
    }
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
  };

  const labelLeft = (pct: number, side: 'start' | 'end') => {
    if (labelsCrowded) {
      return side === 'start'
        ? `${clamp(startPct - 4, 2, 90)}%`
        : `${clamp(endPct + 4, 10, 98)}%`;
    }
    return `${clamp(pct, 2, 98)}%`;
  };

  const leftSpan = off ? null : dayRangeLabel(labelLeftDay, startMin, endMin);
  const rightSpan = off ? null : dayRangeLabel(labelRightDay, startMin, endMin);
  const offLeftPct = absToPct(0);
  const offWidthPct = absToPct(DAY_MIN) - offLeftPct;

  return (
    <div className={[styles.root, readOnly || off ? styles.readOnly : ''].filter(Boolean).join(' ')}>
      <div className={styles.dayLabels}>
        <span>
          {dayTitle(labelLeftDay)}
          {leftSpan ? ` ${leftSpan}` : ''}
        </span>
        <span>
          {dayTitle(labelRightDay)}
          {rightSpan ? ` ${rightSpan}` : ''}
        </span>
        <span className={styles.durationLabel}>{durationLabel ?? ''}</span>
      </div>

      <div
        className={styles.track}
        ref={trackRef}
        onPointerDown={() => {
          if (readOnly || off) return;
          // Клик по ленте (в т.ч. мимо колбаски) — фокус на окно для ←/→.
          rangeRef.current?.focus({ preventScroll: true });
        }}
      >
        <div className={styles.trackClip}>
          <div
            className={styles.trackStrip}
            style={{ transform: `translateX(${stripShiftPct}%)` }}
            aria-hidden="true"
          >
            {([-1, 0, 1] as const).map((d) => (
              <div
                key={d}
                className={[styles.day, highlightDays ? styles.dayOn : ''].filter(Boolean).join(' ')}
              />
            ))}
          </div>
        </div>
        {off ? (
          <div
            className={styles.rangeOff}
            style={{ left: `${offLeftPct}%`, width: `${offWidthPct}%` }}
            aria-label="Выключено на текущие сутки"
          />
        ) : (
          <div
            ref={rangeRef}
            className={styles.range}
            style={{ left: `${startPct}%`, width: `${widthPct}%` }}
            role="slider"
            tabIndex={readOnly ? -1 : 0}
            aria-label="Окно соединения"
            aria-valuemin={OPEN_LO}
            aria-valuemax={HORIZON_HI}
            aria-valuenow={startMin}
            aria-valuetext={`${fmtClock(startMin)} – ${fmtClock(endMin)}`}
            aria-disabled={readOnly}
            onPointerDown={onRangePointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onRangeKeyDown}
          >
            {baseStartMin != null &&
              baseEndMin != null &&
              endMin > startMin &&
              (() => {
                // Base (MOEX) — только пересечение с окном, не «вылезает» за open.
                const lo = Math.max(baseStartMin, startMin);
                const hi = Math.min(baseEndMin, endMin);
                if (hi <= lo) return null;
                const span = endMin - startMin;
                return (
                  <span
                    className={styles.rangeBase}
                    style={{
                      left: `${clamp(((lo - startMin) / span) * 100, 0, 100)}%`,
                      width: `${clamp(((hi - lo) / span) * 100, 0, 100)}%`,
                    }}
                    aria-hidden="true"
                  />
                );
              })()}
          </div>
        )}
        <span className={styles.daySep} aria-hidden="true" />
      </div>

      {!off && (
        <>
          <div className={styles.markers}>
            <button
              type="button"
              className={[styles.marker, styles.markerStart].join(' ')}
              style={{ left: `${startPct}%` }}
              aria-label={`Начало окна ${fmtClock(startMin)}`}
              disabled={readOnly}
              onPointerDown={onEdgePointerDown('start')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <span className={styles.triangle} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={[styles.marker, styles.markerEnd].join(' ')}
              style={{ left: `${endPct}%` }}
              aria-label={`Конец окна ${fmtClock(endMin)}`}
              disabled={readOnly}
              onPointerDown={onEdgePointerDown('end')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <span className={styles.triangle} aria-hidden="true" />
            </button>
          </div>

          <div className={styles.timeLabels}>
            <span className={styles.timeLabel} style={{ left: labelLeft(startPct, 'start') }}>
              {fmtClock(startMin)}
            </span>
            <span className={styles.timeLabel} style={{ left: labelLeft(endPct, 'end') }}>
              {fmtClock(endMin)}
            </span>
          </div>
        </>
      )}
    </div>
  );
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
  let startMin = snapMin(openH * 60 + openM - padHours * 60);
  let endMin = snapMin(closeH * 60 + closeM + padHours * 60);
  const span = endMin - startMin;
  if (span < minSpanMin || span > MAX_SPAN_MIN || endMin <= startMin) {
    return null;
  }
  // Open только сегодня; shift не может увести start во вчера / в завтра.
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

export { DAY_MIN, AXIS_MIN, MAX_SPAN_MIN, OPEN_LO, OPEN_HI, HORIZON_HI, SNAP };
/** @deprecated alias — сессия не уходит во вчера; open ≥ 00:00 today. */
export const HORIZON_LO = OPEN_LO;
