import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

interface Options {
  overscan?: number;
  onNearEnd?: () => void;
}

interface Result {
  ref: RefObject<HTMLDivElement | null>;
  start: number;
  end: number;
  topPad: number;
  bottomPad: number;
  onScroll: () => void;
}

/**
 * Простая вертикальная виртуализация для строк фиксированной высоты: рендерим только видимое окно
 * (+overscan). `onNearEnd` дергается при подходе к низу — для infinite scroll.
 */
export function useVirtualRows(count: number, rowHeight: number, options: Options = {}): Result {
  const overscan = options.overscan ?? 8;
  const onNearEnd = options.onNearEnd;
  const ref = useRef<HTMLDivElement | null>(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(count, 40) });

  const recompute = useCallback(() => {
    const el = ref.current;
    if (!el) {
      return;
    }

    const start = Math.max(0, Math.floor(el.scrollTop / rowHeight) - overscan);
    const end = Math.min(count, Math.ceil((el.scrollTop + el.clientHeight) / rowHeight) + overscan);
    setRange({ start, end });

    if (onNearEnd && el.scrollHeight - (el.scrollTop + el.clientHeight) < rowHeight * overscan) {
      onNearEnd();
    }
  }, [count, rowHeight, overscan, onNearEnd]);

  useEffect(() => {
    recompute();
  }, [recompute]);

  return {
    ref,
    start: range.start,
    end: range.end,
    topPad: range.start * rowHeight,
    bottomPad: Math.max(0, (count - range.end) * rowHeight),
    onScroll: recompute,
  };
}
