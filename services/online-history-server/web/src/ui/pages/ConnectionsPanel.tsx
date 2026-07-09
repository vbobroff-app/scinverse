import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { StatusDot } from '../components/StatusDot';
import styles from './ConnectionsPanel.module.css';

interface Props {
  selectedId: number | null;
  onSelect: (connectionId: number) => void;
}

export function ConnectionsPanel({ selectedId, onSelect }: Props) {
  const store = useOhsStore();
  const connections = useBehavior(store.connections$);

  return (
    <aside className={styles.panel}>
      <h3 className={styles.title}>Провайдеры</h3>
      <ul className={styles.list}>
        {connections.length === 0 && <li className={styles.empty}>Нет подключений</li>}
        {connections.map((c) => (
          <li key={c.connectionId}>
            <button
              className={[styles.item, c.connectionId === selectedId ? styles.active : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelect(c.connectionId)}
            >
              <span className={styles.info}>
                <span className={styles.name}>{c.name}</span>
                <span className={styles.kind}>{c.kind}</span>
              </span>
              <StatusDot status={c.status} />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
