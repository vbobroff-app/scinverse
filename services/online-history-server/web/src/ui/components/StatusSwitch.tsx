import styles from './StatusSwitch.module.css';

export type SwitchPhase = 'off' | 'connecting' | 'active' | 'waiting' | 'degraded' | 'error';

interface Props {
  phase: SwitchPhase;
  label: string;
  title?: string;
  /**
   * `inline` — подпись слева, обычный трек (шапка провайдера).
   * `stacked` — подпись сверху, компактный горизонтальный трек (строка инструмента).
   */
  layout?: 'inline' | 'stacked';
  onToggle: () => void;
}

/**
 * Трёхпозиционный цветной switch (off / middle connecting / on).
 * Общий визуал для ConnectionToggle и RecordingAutoToggle.
 */
export function StatusSwitch({
  phase,
  label,
  title,
  layout = 'inline',
  onToggle,
}: Props) {
  const on = phase === 'active' || phase === 'waiting' || phase === 'degraded';
  const busy = phase === 'connecting';

  return (
    <div className={[styles.wrap, layout === 'stacked' ? styles.stacked : ''].filter(Boolean).join(' ')}>
      <span className={styles.label}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on || busy}
        aria-busy={busy}
        className={[styles.track, styles[phase]].join(' ')}
        onClick={onToggle}
        title={title ?? label}
      >
        <span className={styles.knob}>{on || busy ? '' : '×'}</span>
      </button>
    </div>
  );
}
