import { PowerIcon } from './icons';
import styles from './RecordingToggle.module.css';

interface Props {
  /** Идёт запись — иконка светится. */
  on: boolean;
  /** Переход старт/стоп в процессе. */
  busy?: boolean;
  disabled?: boolean;
  title?: string;
  onToggle: () => void;
}

/** Квадратная toggled-кнопка старт/стоп записи: иконка power светится при включении. */
export function RecordingToggle({ on, busy = false, disabled = false, title, onToggle }: Props) {
  const isDisabled = disabled || busy;
  const tip = title ?? (on ? 'Остановить запись' : 'Начать запись');

  // title на disabled <button> в Chromium не показывается — держим его на обёртке.
  return (
    <span className={styles.wrap} title={tip}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-busy={busy}
        aria-label={tip}
        disabled={isDisabled}
        className={[styles.btn, on ? styles.on : ''].filter(Boolean).join(' ')}
        onClick={onToggle}
      >
        <PowerIcon className={styles.icon} />
      </button>
    </span>
  );
}
