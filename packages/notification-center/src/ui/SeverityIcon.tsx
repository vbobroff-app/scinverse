import type { NotificationSeverity } from '../types';
import styles from './SeverityIcon.module.css';

const LABELS: Record<NotificationSeverity, string> = {
  info: 'I',
  warning: 'W',
  critical: 'C',
  error: 'E',
};

interface Props {
  severity: NotificationSeverity;
}

export function SeverityIcon({ severity }: Props) {
  return (
    <span
      className={[styles.icon, styles[severity]].filter(Boolean).join(' ')}
      title={severity}
      aria-label={severity}
    >
      {LABELS[severity]}
    </span>
  );
}
