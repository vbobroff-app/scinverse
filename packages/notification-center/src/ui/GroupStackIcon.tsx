import { Tip } from './Tooltip';
import styles from './GroupStackIcon.module.css';

interface Props {
  /** Подпись тултипа. */
  title?: string;
  className?: string;
}

/**
 * Иконка Group: два перекрывающихся квадрата (заголовок Thread).
 * Размер 11×11.
 */
export function GroupStackIcon({ title = 'Group', className }: Props) {
  const svg = (
    <span
      className={[styles.icon, className].filter(Boolean).join(' ')}
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
