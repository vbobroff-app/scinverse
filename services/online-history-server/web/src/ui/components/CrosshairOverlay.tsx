import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { crosshair$ } from '../../core/crosshair';
import { useBehavior } from '../hooks/useObservable';
import styles from './CrosshairOverlay.module.css';

const EDGE = 8; // минимальный отступ подписи от края вьюпорта, px
/** Смещение метки от верха оси (px); отрицательное — выше. */
const LABEL_DROP = -2;

interface Props {
  /** Скролл-контейнер списка — верхняя граница линии. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Ячейка оси времени — нижняя граница линии и место подписи. */
  axisRef: RefObject<HTMLDivElement | null>;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Время под курсором `HH:mm:ss` в заданном ТЗ; на правом крае полночь → «24:00:00». */
function fmtTime(ms: number, offMin: number, atEnd: boolean): string {
  const d = new Date(ms + offMin * 60_000);
  const s = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return atEnd && s === '00:00:00' ? '24:00:00' : s;
}

interface Geometry {
  x: number;
  top: number;
  height: number;
  labelTop: number;
  labelLeft: number;
}

/**
 * Единственный слой вертикального «прицела»: линия по X курсора через все дорожки Ганта и подпись
 * времени у оси. Подписан на {@link crosshair$}; геометрию (верх/низ линии, место подписи) берёт из
 * refs скролл-контейнера и ячейки оси, поэтому не завязан на конкретную строку.
 */
export function CrosshairOverlay({ scrollRef, axisRef }: Props) {
  const cross = useBehavior(crosshair$);
  const labelRef = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<Geometry | null>(null);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const axis = axisRef.current;
    if (!cross || !scroll || !axis) {
      setGeom(null);
      return;
    }
    const sRect = scroll.getBoundingClientRect();
    const aRect = axis.getBoundingClientRect();
    const x = Math.min(Math.max(cross.x, cross.trackLeft), cross.trackRight);
    const top = sRect.top;
    const bottom = aRect.top; // линия доходит до оси, подпись садится на ось
    const labelW = labelRef.current?.offsetWidth ?? 0;
    const labelLeft = Math.min(Math.max(x - labelW / 2, EDGE), window.innerWidth - labelW - EDGE);
    setGeom({
      x,
      top,
      height: Math.max(0, bottom - top),
      labelTop: aRect.top + LABEL_DROP,
      labelLeft,
    });
  }, [cross, scrollRef, axisRef]);

  if (!cross) {
    return null;
  }

  return (
    <>
      <div
        className={styles.line}
        style={{
          left: geom ? geom.x : cross.x,
          top: geom ? geom.top : 0,
          height: geom ? geom.height : 0,
          visibility: geom ? 'visible' : 'hidden',
        }}
      />
      <div
        ref={labelRef}
        className={styles.label}
        style={{
          left: geom ? geom.labelLeft : cross.x,
          top: geom ? geom.labelTop : 0,
          visibility: geom ? 'visible' : 'hidden',
        }}
      >
        {fmtTime(cross.ms, cross.tzOffsetMin, cross.atEnd)}
      </div>
    </>
  );
}
