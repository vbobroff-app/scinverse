import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './Tooltip.module.css';

type Side = 'bottom' | 'top';

export interface TipProps {
  /** Текст тултипа. Пустой / undefined — без тултипа. */
  content?: string;
  /** Предпочтительная сторона (по умолчанию снизу по центру; у края — сверху). */
  side?: Side;
  /** Растянуть host на 100% (ячейки сетки / full-width кнопки). */
  block?: boolean;
  /** Ограничить позицию (иначе — viewport). */
  boundaryRef?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}

interface Pos {
  left: number;
  top: number;
  side: Side;
}

const VIEW_PAD = 8;

function isDisabledControl(root: HTMLElement): boolean {
  if (root instanceof HTMLButtonElement && root.disabled) return true;
  if (root.getAttribute('aria-disabled') === 'true') return true;
  const control = root.querySelector('button, input, select, textarea');
  if (control instanceof HTMLButtonElement && control.disabled) return true;
  if (control?.getAttribute('aria-disabled') === 'true') return true;
  if (control instanceof HTMLInputElement && control.disabled) return true;
  return false;
}

function clampCenterX(centerX: number, tipWidth: number, bound: DOMRect): number {
  const half = tipWidth / 2;
  const min = bound.left + VIEW_PAD + half;
  const max = bound.right - VIEW_PAD - half;
  if (min > max) return (bound.left + bound.right) / 2;
  return Math.min(Math.max(centerX, min), max);
}

/**
 * Лёгкий кастомный тултип для notification-center (portal → не клипается overflow дока).
 * Не ставьте рядом нативный `title` — будет двойной тултип.
 */
export function Tip({ content, side = 'bottom', block = false, boundaryRef, className, children }: TipProps) {
  const tipId = useId();
  const tipRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  const hide = useCallback(() => setPos(null), []);

  const showFrom = useCallback(
    (el: HTMLElement) => {
      if (!content || isDisabledControl(el)) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const gap = 8;
      const tipEstimate = 36;
      const bound = boundaryRef?.current?.getBoundingClientRect() ?? {
        left: 0,
        right: window.innerWidth,
        top: 0,
        bottom: window.innerHeight,
        width: window.innerWidth,
        height: window.innerHeight,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };

      let nextSide = side;
      let top = side === 'bottom' ? rect.bottom + gap : rect.top - gap;

      if (side === 'bottom' && bound.bottom - rect.bottom < tipEstimate) {
        nextSide = 'top';
        top = rect.top - gap;
      } else if (side === 'top' && rect.top - bound.top < tipEstimate) {
        nextSide = 'bottom';
        top = rect.bottom + gap;
      }

      // Грубая ширина до measure — чтобы сразу не вылезать за левый край.
      const roughW = Math.min(260, Math.max(80, content.length * 7));
      const left = clampCenterX(rect.left + rect.width / 2, roughW, bound as DOMRect);

      setPos({ left, top, side: nextSide });
    },
    [boundaryRef, content, side],
  );

  useLayoutEffect(() => {
    if (!pos || !tipRef.current) return;
    const tipRect = tipRef.current.getBoundingClientRect();
    const bound = boundaryRef?.current?.getBoundingClientRect() ?? {
      left: 0,
      right: window.innerWidth,
      top: 0,
      bottom: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
    const nextLeft = clampCenterX(pos.left, tipRect.width, bound as DOMRect);
    if (Math.abs(nextLeft - pos.left) > 0.5) {
      setPos((p) => (p ? { ...p, left: nextLeft } : p));
    }
  }, [boundaryRef, pos]);

  if (!content) {
    return <>{children}</>;
  }

  return (
    <span
      className={[styles.host, block ? styles.hostBlock : '', className].filter(Boolean).join(' ')}
      aria-describedby={pos ? tipId : undefined}
      onMouseEnter={(e) => showFrom(e.currentTarget)}
      onMouseLeave={hide}
      onFocus={(e) => showFrom(e.currentTarget)}
      onBlur={hide}
    >
      {children}
      {pos &&
        createPortal(
          <span
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className={[styles.tip, pos.side === 'top' ? styles.tipTop : styles.tipBottom].join(' ')}
            style={{ left: pos.left, top: pos.top } as CSSProperties}
          >
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}
