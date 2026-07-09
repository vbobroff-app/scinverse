import styles from './StatusDot.module.css';

const COLOR: Record<string, string> = {
  connected: 'var(--color-success)',
  disconnected: 'var(--color-text-muted)',
  error: 'var(--color-error)',
};

const LABEL: Record<string, string> = {
  connected: 'подключён',
  disconnected: 'отключён',
  error: 'ошибка',
};

export function StatusDot({ status }: { status: string }) {
  const color = COLOR[status] ?? 'var(--color-warning)';
  return (
    <span className={styles.wrap} title={status}>
      <span className={styles.dot} style={{ backgroundColor: color }} />
      <span className={styles.label}>{LABEL[status] ?? status}</span>
    </span>
  );
}
