import { tzDateOf } from '../../core/moexSession';
import { makeProjector } from '../../core/sessionProjection';
import type { SessionDto } from '../../core/types';
import styles from './ConnectionLane.module.css';

const DAY_MS = 24 * 60 * 60_000;

export interface ScrubGeom {
  rulerLeft: number;
  rulerWidth: number;
  lineTop: number;
  lineHeight: number;
  labelTop: number;
  /** Разделители суток: от верхней кромки .right до label. */
  dayLineTop: number;
  dayLineHeight: number;
}

/**
 * Вертикальный scrub time-line вне React-дерева (fixed → document.body).
 * Движение не зависит от ререндеров ConnectionLane / Ribbon (useNow, link$).
 * Вместе с scrub — статичные разделители суток (не паркуются).
 */
export type ConnectionScrubLayer = {
  syncGeom: (geom: ScrubGeom) => void;
  setLabels: (lut: readonly string[]) => void;
  /** Позиции разделителей суток в % оси (0..100). */
  setDaySeps: (leftPcts: readonly number[]) => void;
  show: (clientX: number) => void;
  /** Coalesced через rAF — на экране всегда последний X. */
  move: (clientX: number) => void;
  /** Курсор вне ганта: спрятать полоску/label, scrub-режим не сбрасывать. */
  park: () => void;
  /** Курсор снова в ганте: показать на clientX. */
  unpark: (clientX: number) => void;
  hide: () => void;
  destroy: () => void;
};

/** Полуночь display-TZ для календарного дня момента `ms`. */
function midnightTz(ms: number, offMin: number): number {
  const d = tzDateOf(ms, offMin);
  return Date.UTC(d.year, d.month - 1, d.day, 0, 0) - offMin * 60_000;
}

/**
 * Разделители суток на оси Connection: швы между сессиями, иначе полуночи display-TZ.
 * Края окна (≈0 / ≈100) отбрасываем.
 */
export function buildDaySepPcts(
  fromMs: number,
  toMs: number,
  sessions: SessionDto[] | undefined,
  tzOffsetMin: number,
): number[] {
  const pct = makeProjector(fromMs, toMs, sessions);
  const out: number[] = [];
  const push = (ms: number) => {
    const p = pct(ms);
    if (p > 0.3 && p < 99.7) {
      out.push(p);
    }
  };

  if (sessions && sessions.length > 1) {
    for (let i = 1; i < sessions.length; i++) {
      push(Date.parse(sessions[i]!.start));
    }
    return out;
  }

  for (let t = midnightTz(fromMs, tzOffsetMin) + DAY_MS; t < toMs; t += DAY_MS) {
    if (t > fromMs) {
      push(t);
    }
  }
  return out;
}

export function createConnectionScrubLayer(): ConnectionScrubLayer {
  const line = document.createElement('div');
  line.className = styles.scrubLineFixed;
  line.setAttribute('aria-hidden', 'true');
  line.hidden = true;

  const label = document.createElement('span');
  label.className = styles.scrubLabelFixed;
  label.hidden = true;

  document.body.append(line, label);

  let geom: ScrubGeom = {
    rulerLeft: 0,
    rulerWidth: 1,
    lineTop: 0,
    lineHeight: 1,
    labelTop: 0,
    dayLineTop: 0,
    dayLineHeight: 1,
  };
  let lut: readonly string[] = [];
  let dayPcts: readonly number[] = [];
  const dayEls: HTMLDivElement[] = [];
  let lastLabel = '';
  let pendingX: number | null = null;
  let raf = 0;
  let active = false;
  let parked = false;

  const paint = (clientX: number) => {
    const xInRuler = Math.min(Math.max(0, clientX - geom.rulerLeft), geom.rulerWidth);
    const x = Math.min(lut.length - 1, Math.max(0, Math.round(xInRuler)));
    const vx = geom.rulerLeft + xInRuler;
    // left=0 + translate3d(viewportX) — без чтения layout на hot-path.
    line.style.transform = `translate3d(${vx}px,0,0)`;
    label.style.transform = `translate3d(${vx}px,0,0) translateX(-50%)`;
    const next = lut[x] ?? '';
    if (next && next !== lastLabel) {
      lastLabel = next;
      label.textContent = next;
    }
  };

  const applyGeomStyles = () => {
    line.style.top = `${geom.lineTop}px`;
    line.style.height = `${geom.lineHeight}px`;
    label.style.top = `${geom.labelTop}px`;
    for (const el of dayEls) {
      el.style.top = `${geom.dayLineTop}px`;
      el.style.height = `${geom.dayLineHeight}px`;
    }
  };

  const paintDaySeps = () => {
    for (let i = 0; i < dayEls.length; i++) {
      const el = dayEls[i]!;
      const p = dayPcts[i] ?? 0;
      // Центр как у тика (left%); translateX(-50%) центрирует 1px без margin-left: -0.5px.
      const vx = geom.rulerLeft + (p / 100) * geom.rulerWidth;
      el.style.top = `${geom.dayLineTop}px`;
      el.style.height = `${geom.dayLineHeight}px`;
      el.style.transform = `translate3d(${vx}px,0,0) translateX(-50%)`;
      el.hidden = !active;
    }
  };

  const syncDayEls = () => {
    while (dayEls.length > dayPcts.length) {
      dayEls.pop()!.remove();
    }
    while (dayEls.length < dayPcts.length) {
      const el = document.createElement('div');
      el.className = [styles.scrubLineFixed, styles.scrubDaySepFixed].join(' ');
      el.setAttribute('aria-hidden', 'true');
      el.hidden = !active;
      document.body.append(el);
      dayEls.push(el);
    }
    paintDaySeps();
  };

  return {
    syncGeom(next) {
      geom = next;
      applyGeomStyles();
      if (active) {
        paintDaySeps();
      }
    },
    setLabels(next) {
      lut = next;
      lastLabel = '';
    },
    setDaySeps(leftPcts) {
      dayPcts = leftPcts;
      syncDayEls();
    },
    show(clientX) {
      active = true;
      parked = false;
      applyGeomStyles();
      line.hidden = false;
      label.hidden = false;
      lastLabel = '';
      paint(clientX);
      paintDaySeps();
    },
    move(clientX) {
      if (!active || parked) {
        return;
      }
      pendingX = clientX;
      if (raf) {
        return;
      }
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (pendingX != null && active && !parked) {
          paint(pendingX);
        }
      });
    },
    park() {
      if (!active || parked) {
        return;
      }
      parked = true;
      line.hidden = true;
      label.hidden = true;
      pendingX = null;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      // day seps остаются
    },
    unpark(clientX) {
      if (!active || !parked) {
        return;
      }
      parked = false;
      applyGeomStyles();
      line.hidden = false;
      label.hidden = false;
      lastLabel = '';
      paint(clientX);
    },
    hide() {
      active = false;
      parked = false;
      line.hidden = true;
      label.hidden = true;
      lastLabel = '';
      pendingX = null;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      for (const el of dayEls) {
        el.hidden = true;
      }
    },
    destroy() {
      this.hide();
      line.remove();
      label.remove();
      for (const el of dayEls) {
        el.remove();
      }
      dayEls.length = 0;
    },
  };
}

/** Геометрия scrub из bounding-box контейнера и линейки. */
export function scrubGeomFromElements(right: HTMLElement, ruler: HTMLElement): ScrubGeom {
  const rr = right.getBoundingClientRect();
  const ru = ruler.getBoundingClientRect();
  const top = rr.top;
  const labelTop = ru.bottom;
  const height = Math.max(1, labelTop - top);
  return {
    rulerLeft: ru.left,
    rulerWidth: Math.max(1, ru.width),
    /** Курсор и разделители суток: от верхней кромки .right до label. */
    lineTop: top,
    lineHeight: height,
    labelTop,
    dayLineTop: top,
    dayLineHeight: height,
  };
}
