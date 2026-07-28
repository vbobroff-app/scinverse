import type { NotificationSeverity } from '../types';
import { Tip } from './Tooltip';
import styles from './GroupStackIcon.module.css';

interface Props {
  /** Подпись тултипа. */
  title?: string;
  className?: string;
  /** Severity последнего Entry в стеке — красит иконку. */
  severity?: NotificationSeverity;
}

function severityClass(severity: NotificationSeverity | undefined): string | undefined {
  switch (severity) {
    case 'info':
      return styles.sevInfo;
    case 'warning':
      return styles.sevWarning;
    case 'error':
    case 'critical':
      return styles.sevAlert;
    case 'ok':
      return styles.sevOk;
    default:
      return undefined;
  }
}

/**
 * Иконка Group: два перекрывающихся квадрата (заголовок Thread).
 * Цвет следует severity последнего уведомления в стеке (без моргания).
 */
export function GroupStackIcon({ title = 'Group', className, severity }: Props) {
  const svg = (
    <span
      className={[styles.icon, severityClass(severity), className].filter(Boolean).join(' ')}
      aria-label={title}
      role="img"
    >
      <svg
        className={styles.svg}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M0 0h24v24H0z" fill="none" />
        <path className={styles.layer} d="M8 22v-6H2V2h14v6h6v14z" />
      </svg>
    </span>
  );

  return <Tip content={title}>{svg}</Tip>;
}
