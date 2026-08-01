import styles from './ConnectionLane.module.css';

export interface ScrubGeom {
  rulerLeft: number;
  rulerWidth: number;
  lineTop: number;
  lineHeight: number;
  labelTop: number;
}

/**
 * Вертикальный scrub time-line вне React-дерева (fixed → document.body).
 * Движение не зависит от ререндеров ConnectionLane / Ribbon (useNow, link$).
 */
export type ConnectionScrubLayer = {
  syncGeom: (geom: ScrubGeom) => void;
  setLabels: (lut: readonly string[]) => void;
  show: (clientX: number) => void;
  /** Coalesced через rAF — на экране всегда последний X. */
  move: (clientX: number) => void;
  hide: () => void;
  destroy: () => void;
};

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
  };
  let lut: readonly string[] = [];
  let lastLabel = '';
  let pendingX: number | null = null;
  let raf = 0;
  let active = false;

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
  };

  return {
    syncGeom(next) {
      geom = next;
      applyGeomStyles();
    },
    setLabels(next) {
      lut = next;
      lastLabel = '';
    },
    show(clientX) {
      active = true;
      applyGeomStyles();
      line.hidden = false;
      label.hidden = false;
      lastLabel = '';
      paint(clientX);
    },
    move(clientX) {
      if (!active) {
        return;
      }
      pendingX = clientX;
      if (raf) {
        return;
      }
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (pendingX != null && active) {
          paint(pendingX);
        }
      });
    },
    hide() {
      active = false;
      line.hidden = true;
      label.hidden = true;
      lastLabel = '';
      pendingX = null;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    destroy() {
      this.hide();
      line.remove();
      label.remove();
    },
  };
}

/** Геометрия scrub из bounding-box контейнера и линейки. */
export function scrubGeomFromElements(right: HTMLElement, ruler: HTMLElement): ScrubGeom {
  const rr = right.getBoundingClientRect();
  const ru = ruler.getBoundingClientRect();
  const padTop = 4;
  return {
    rulerLeft: ru.left,
    rulerWidth: Math.max(1, ru.width),
    lineTop: rr.top + padTop,
    lineHeight: Math.max(1, ru.top - rr.top - padTop),
    labelTop: ru.bottom,
  };
}
