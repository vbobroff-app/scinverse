import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import styles from './ScheduleWindowRibbon.module.css';

const DAY_MIN = 24 * 60;
const AXIS_MIN = 48 * 60;
/** Окно соединения ≤ одних суток. */
const MAX_SPAN_MIN = DAY_MIN;
/** Hard frame горизонта: 00:00 вчера … 24:00 завтра. Дальше лента не едет. */
const HORIZON_LO = -DAY_MIN;
const HORIZON_HI = AXIS_MIN;
const SNAP = 5;
/** Виртуальный overscroll (мин), после которого переключаем модель дней. */
const OVERSCROLL_COMMIT = 40;
const SLIDE_MS = 340;

/** 0 = сегодня|завтра, -1 = вчера|сегодня. */
export type ScheduleViewDay = 0 | -1;

export interface ScheduleWindowRibbonProps {
  /**
   * Абсолютные минуты от полуночи сегодня.
   * yesterday-today: примерно [-24h .. +24h], today-tomorrow: [0 .. +48h].
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
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function snapMin(m: number): number {
  return Math.round(m / SNAP) * SNAP;
}

function viewOrigin(view: ScheduleViewDay): number {
  return view * DAY_MIN;
}

function viewBounds(view: ScheduleViewDay): { lo: number; hi: number } {
  const lo = viewOrigin(view);
  // Пара дней, но не шире hard frame горизонта.
  return {
    lo: Math.max(lo, HORIZON_LO),
    hi: Math.min(lo + AXIS_MIN, HORIZON_HI),
  };
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
  /** Накопленный уход за край после магнита к 00:00 сегодня. */
  overscroll: number;
};

type EdgeDrag = { kind: 'start' | 'end' };

/**
 * Редактор окна соединения на оси 48h: две модели дней (вчера|сегодня / сегодня|завтра),
 * непрерывная подсветка диапазона и drag всей полосы / маркеров.
 */
export function ScheduleWindowRibbon({
  startMin,
  endMin,
  onChange,
  highlightDays = false,
  readOnly = false,
  baseStartMin = null,
  baseEndMin = null,
}: ScheduleWindowRibbonProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<MoveDrag | EdgeDrag | null>(null);
  const startMinRef = useRef(startMin);
  const endMinRef = useRef(endMin);
  startMinRef.current = startMin;
  endMinRef.current = endMin;

  const [viewDay, setViewDay] = useState<ScheduleViewDay>(0);
  /** 0 = today-tomorrow, 1 = yesterday-today (для анимации strip + позиций). */
  const [slide, setSlide] = useState(0);
  const slideRef = useRef(0);
  const animRef = useRef<number | null>(null);
  const slidingRef = useRef(false);

  const displayOrigin = viewOrigin(0) + slide * viewOrigin(-1); // 0 → -DAY_MIN
  const stripShiftPct = -((1 - slide) * (100 / 3)); // -33.33% → 0%

  const absToPct = (abs: number) => ((abs - displayOrigin) / AXIS_MIN) * 100;

  const startPct = absToPct(startMin);
  const endPct = absToPct(endMin);
  const widthPct = Math.max(0, endPct - startPct);
  const labelsCrowded = endPct - startPct < 10;

  // Подписи по текущей/целевой модели (без мигания на середине анимации).
  const labelView: ScheduleViewDay = slide >= 0.5 ? -1 : 0;
  const labelLeftDay = labelView;
  const labelRightDay = (labelView + 1) as 0 | 1;

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

  const animateSlideTo = useCallback((target: 0 | 1, onDone?: () => void) => {
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
        setViewDay(target === 0 ? 0 : -1);
        slidingRef.current = false;
        onDone?.();
      }
    };
    animRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    // Шаблон с уходом вчера / в завтра → анимированный scroll-day.
    if (dragRef.current || slidingRef.current) {
      return;
    }
    if (startMin < 0) {
      if (slideRef.current < 1) {
        animateSlideTo(1);
      }
      return;
    }
    if (endMin > DAY_MIN && slideRef.current > 0) {
      animateSlideTo(0);
    }
  }, [startMin, endMin, animateSlideTo]);

  useEffect(
    () => () => {
      if (animRef.current != null) {
        cancelAnimationFrame(animRef.current);
      }
    },
    [],
  );

  const commitScrollLeft = (drag: MoveDrag, clientX: number) => {
    // today-tomorrow → yesterday-today; окно остаётся на abs-времени (у магнита ~00:00 today).
    animateSlideTo(1, () => {
      if (dragRef.current?.kind === 'move') {
        dragRef.current = {
          ...dragRef.current,
          originClientX: clientX,
          originStart: startMinRef.current,
          overscroll: 0,
        };
      }
    });
    drag.overscroll = 0;
  };

  const commitScrollRight = (drag: MoveDrag, clientX: number) => {
    animateSlideTo(0, () => {
      if (dragRef.current?.kind === 'move') {
        dragRef.current = {
          ...dragRef.current,
          originClientX: clientX,
          originStart: startMinRef.current,
          overscroll: 0,
        };
      }
    });
    drag.overscroll = 0;
  };

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
      const view: ScheduleViewDay = slideRef.current >= 0.5 ? -1 : 0;
      const { lo, hi } = viewBounds(view);
      const minStart = lo;
      const maxStart = hi - span;

      if (view === 0) {
        // Влево: упор в 00:00 сегодня (магнит), overscroll → yesterday-today.
        // Вправо: hard frame 24:00 tomorrow (maxStart), без дальнейшего scroll.
        if (desired <= 0) {
          onChange(0, span);
          drag.overscroll = -desired;
          const peek = clamp(drag.overscroll / OVERSCROLL_COMMIT, 0, 1) * 0.18;
          slideRef.current = peek;
          setSlide(peek);
          if (drag.overscroll >= OVERSCROLL_COMMIT) {
            commitScrollLeft(drag, e.clientX);
          }
          return;
        }
        drag.overscroll = 0;
        if (slideRef.current > 0 && slideRef.current < 0.5) {
          slideRef.current = 0;
          setSlide(0);
        }
        desired = clamp(desired, 0, maxStart);
        onChange(desired, desired + span);
        return;
      }

      // view === -1: вправо упираемся в 24:00 сегодня → today-tomorrow.
      // Влево: hard frame 00:00 yesterday (minStart), без further scroll.
      if (desired >= maxStart) {
        onChange(maxStart, maxStart + span);
        drag.overscroll = desired - maxStart;
        const peek = 1 - clamp(drag.overscroll / OVERSCROLL_COMMIT, 0, 1) * 0.18;
        slideRef.current = peek;
        setSlide(peek);
        if (drag.overscroll >= OVERSCROLL_COMMIT) {
          commitScrollRight(drag, e.clientX);
        }
        return;
      }
      drag.overscroll = 0;
      if (slideRef.current < 1 && slideRef.current > 0.5) {
        slideRef.current = 1;
        setSlide(1);
      }
      desired = clamp(desired, minStart, maxStart);
      onChange(desired, desired + span);
      return;
    }

    const m = snapMin(clientXToAbs(e.clientX));
    const view: ScheduleViewDay = slideRef.current >= 0.5 ? -1 : 0;
    const { lo, hi } = viewBounds(view);
    const s = startMinRef.current;
    const en = endMinRef.current;
    if (drag.kind === 'start') {
      onChange(clamp(m, Math.max(lo, en - MAX_SPAN_MIN), en - SNAP), en);
    } else {
      onChange(s, clamp(m, s + SNAP, Math.min(hi, s + MAX_SPAN_MIN)));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    // Если peek не дотянули до commit — пружина обратно.
    if (drag.kind === 'move' && !slidingRef.current) {
      const target: 0 | 1 = slideRef.current >= 0.5 ? 1 : 0;
      if (Math.abs(slideRef.current - target) > 0.001) {
        animateSlideTo(target);
      }
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

  const leftSpan = dayRangeLabel(labelLeftDay, startMin, endMin);
  const rightSpan = dayRangeLabel(labelRightDay, startMin, endMin);

  return (
    <div className={[styles.root, readOnly ? styles.readOnly : ''].filter(Boolean).join(' ')}>
      <div className={styles.dayLabels}>
        <span>
          {dayTitle(labelLeftDay)}
          {leftSpan ? ` ${leftSpan}` : ''}
        </span>
        <span>
          {dayTitle(labelRightDay)}
          {rightSpan ? ` ${rightSpan}` : ''}
        </span>
      </div>

      <div className={styles.track} ref={trackRef}>
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
        <div
          className={styles.range}
          style={{ left: `${startPct}%`, width: `${widthPct}%` }}
          role="slider"
          aria-label="Окно соединения"
          aria-valuemin={viewBounds(viewDay).lo}
          aria-valuemax={viewBounds(viewDay).hi}
          aria-valuenow={startMin}
          aria-disabled={readOnly}
          onPointerDown={onRangePointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {baseStartMin != null &&
            baseEndMin != null &&
            baseEndMin > baseStartMin &&
            endMin > startMin && (
              <span
                className={styles.rangeBase}
                style={{
                  left: `${clamp(((baseStartMin - startMin) / (endMin - startMin)) * 100, 0, 100)}%`,
                  width: `${clamp(((baseEndMin - baseStartMin) / (endMin - startMin)) * 100, 0, 100)}%`,
                }}
                aria-hidden="true"
              />
            )}
        </div>
        <span className={styles.daySep} aria-hidden="true" />
      </div>

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
    </div>
  );
}

/**
 * Шаблон open/close + pad часов → абсолютные минуты от полуночи сегодня.
 * Pad расширяет окно: start−pad, end+pad.
 * null, если span > 24ч или окно не влезает в hard frame [00:00 yesterday .. 24:00 tomorrow]
 * и ни в одну из двух моделей дней.
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
  // base±shift длиннее суток — shift недоступен.
  if (span < minSpanMin || span > MAX_SPAN_MIN || endMin <= startMin) {
    return null;
  }
  // Hard frame горизонта.
  if (startMin < HORIZON_LO || endMin > HORIZON_HI) {
    return null;
  }
  const inTodayTomorrow = startMin >= 0 && endMin <= AXIS_MIN;
  const inYesterdayToday = startMin >= -DAY_MIN && endMin <= DAY_MIN;
  if (!inTodayTomorrow && !inYesterdayToday) {
    return null;
  }
  return { startMin, endMin };
}

/** HH:mm → минуты 0..1439. */
export function parseHmToMin(hhmm: string): number {
  const [hh, mm] = hhmm.split(':').map((x) => Number(x));
  return (hh || 0) * 60 + (mm || 0);
}

/** Минуты (могут быть > суток / отрицательные) → HH:mm в пределах суток. */
export function fmtMinToHm(total: number): string {
  return fmtClock(total);
}

/**
 * Из API-окон HH:mm → минуты от полуночи сегодня (overnight: end уезжает во «завтра»).
 */
export function windowToAxisMins(startHm: string, endHm: string): { startMin: number; endMin: number } {
  let startMin = snapMin(parseHmToMin(startHm));
  let endMin = snapMin(parseHmToMin(endHm));
  if (endMin <= startMin) {
    endMin += DAY_MIN;
  }
  startMin = clamp(startMin, 0, AXIS_MIN - SNAP);
  endMin = clamp(endMin, startMin + SNAP, Math.min(AXIS_MIN, startMin + MAX_SPAN_MIN));
  return { startMin, endMin };
}

/** Абсолютные минуты → пара HH:mm для API (end может быть «раньше» start при overnight). */
export function axisMinsToWindow(startMin: number, endMin: number): { start: string; end: string } {
  return {
    start: fmtMinToHm(startMin),
    end: fmtMinToHm(endMin),
  };
}

export { DAY_MIN, AXIS_MIN, MAX_SPAN_MIN, HORIZON_LO, HORIZON_HI, SNAP };
