import { EXCHANGES } from '../../core/exchanges';
import styles from './ExchangesPanel.module.css';

interface Props {
  selectedCode: string | null;
  onSelect: (code: string) => void;
}

/** Левая панель раздела «Биржи» — список бирж (тот же паттерн, что у провайдеров). */
export function ExchangesPanel({ selectedCode, onSelect }: Props) {
  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>Биржи</h3>
      </div>

      <ul className={styles.list}>
        {EXCHANGES.length === 0 && <li className={styles.empty}>Нет бирж</li>}
        {EXCHANGES.map((ex) => (
          <li key={ex.code}>
            <button
              className={[styles.item, ex.code === selectedCode ? styles.active : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelect(ex.code)}
            >
              <span className={styles.info}>
                <span className={styles.name}>{ex.code}</span>
                <span className={styles.kind}>{ex.name}</span>
              </span>
              {!ex.ready && <span className={styles.soon}>скоро</span>}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
