import { useMemo } from 'react';
import type { CoverageWindow } from '../../core/OhsStore';
import styles from './TimeAxis.module.css';

const TICKS = 6;

export function TimeAxis({ window }: { window: CoverageWindow }) {
  const fromMs = Date.parse(window.from);
  const toMs = Date.parse(window.to);
  const span = Math.max(1, toMs - fromMs);

  const ticks = useMemo(
    () =>
      Array.from({ length: TICKS + 1 }, (_, i) => ({
        left: (i / TICKS) * 100,
        label: new Date(fromMs + (span * i) / TICKS).toLocaleTimeString(),
      })),
    [fromMs, span],
  );

  return (
    <div className={styles.axis}>
      {ticks.map((t, i) => (
        <span key={i} className={styles.tick} style={{ left: `${t.left}%` }}>
          {t.label}
        </span>
      ))}
    </div>
  );
}
