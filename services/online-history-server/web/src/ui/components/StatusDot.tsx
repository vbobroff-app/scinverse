import styles from './StatusDot.module.css';

const COLOR: Record<string, string> = {
  active: 'var(--color-accent)',
  waiting: 'var(--color-success)',
  connected: 'var(--color-success)',
  degraded: 'var(--color-warning)',
  connecting: 'var(--color-warning)',
  disconnected: 'var(--color-text-muted)',
  error: 'var(--color-error)',
};

const LABEL: Record<string, string> = {
  active: 'подключён (данные идут)',
  waiting: 'подключён (ожидание)',
  connected: 'подключён',
  degraded: 'восстановление связи',
  connecting: 'подключается…',
  disconnected: 'отключён',
  error: 'ошибка',
};

export function StatusDot({ status }: { status: string }) {
  const color = COLOR[status] ?? 'var(--color-warning)';
  return (
    <span
      className={styles.dot}
      style={{ backgroundColor: color }}
      title={LABEL[status] ?? status}
      aria-label={LABEL[status] ?? status}
    />
  );
}
