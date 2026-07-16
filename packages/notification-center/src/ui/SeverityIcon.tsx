import type { NotificationSeverity } from '../types';
import styles from './SeverityIcon.module.css';

/** Глифы в стиле legacy notificationcenter-mfe (круг + символ). */
const GLYPHS: Record<NotificationSeverity, string> = {
  ok: '✓',
  info: 'i',
  warning: '!',
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

export function SeverityIcon({ severity }: Props) {
  return (
    <span
      className={[styles.icon, styles[severity]].filter(Boolean).join(' ')}
      title={TITLES[severity]}
      aria-label={TITLES[severity]}
    >
      {GLYPHS[severity]}
    </span>
  );
}
