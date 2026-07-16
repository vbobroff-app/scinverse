import type { NotificationSeverity } from '../types';
import { Tip } from './Tooltip';
import styles from './SeverityIcon.module.css';

/** Глифы в скруглённом квадрате (warning — отдельный треугольник). */
const GLYPHS: Record<Exclude<NotificationSeverity, 'warning'>, string> = {
  ok: '✓',
  info: 'i',
  error: '×',
  critical: '!',
};

const TITLES: Record<NotificationSeverity, string> = {
  ok: 'ок',
  info: 'info',
  warning: 'warning',
  error: 'error',
  critical: 'critical',
};

interface Props {
  severity: NotificationSeverity;
}

/** Классический warning-треугольник с восклицательным знаком. */
function WarningTriangle() {
  return (
    <svg className={styles.triangle} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        className={styles.triangleFill}
        d="M8 1.2 15.2 14.2H0.8L8 1.2Z"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        className={styles.triangleBang}
        d="M8 5.6v3.6M8 11.4v.2"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SeverityIcon({ severity }: Props) {
  const label = TITLES[severity];

  if (severity === 'warning') {
    return (
      <Tip content={label}>
        <span className={[styles.icon, styles.warning].join(' ')} aria-label={label}>
          <WarningTriangle />
        </span>
      </Tip>
    );
  }

  return (
    <Tip content={label}>
      <span className={[styles.icon, styles[severity]].filter(Boolean).join(' ')} aria-label={label}>
        {GLYPHS[severity]}
      </span>
    </Tip>
  );
}
