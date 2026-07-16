import { useCallback, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Tooltip.module.css';

type Side = 'bottom' | 'top';

export interface TipProps {
  /** Текст тултипа. Пустой / undefined — без тултипа. */
  content?: string;
  /** Предпочтительная сторона (по умолчанию снизу по центру; у края — сверху). */
  side?: Side;
  className?: string;
  children: ReactNode;
}

interface Pos {
  left: number;
  top: number;
  side: Side;
}

/**
 * Лёгкий кастомный тултип для notification-center (portal → не клипается overflow дока).
 * Не ставьте рядом нативный `title` — будет двойной тултип.
 */
export function Tip({ content, side = 'bottom', className, children }: TipProps) {
  const tipId = useId();
  const [pos, setPos] = useState<Pos | null>(null);

  const hide = useCallback(() => setPos(null), []);

  const showFrom = useCallback(
    (el: HTMLElement) => {
      if (!content) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const gap = 8;
      const tipEstimate = 36;
      let nextSide = side;
      let top = side === 'bottom' ? rect.bottom + gap : rect.top - gap;

      if (side === 'bottom' && window.innerHeight - rect.bottom < tipEstimate) {
        nextSide = 'top';
        top = rect.top - gap;
      } else if (side === 'top' && rect.top < tipEstimate) {
        nextSide = 'bottom';
        top = rect.bottom + gap;
      }

      setPos({
        left: rect.left + rect.width / 2,
        top,
        side: nextSide,
      });
    },
    [content, side],
  );

  if (!content) {
    return <>{children}</>;
  }

  return (
    <span
      className={[styles.host, className].filter(Boolean).join(' ')}
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
