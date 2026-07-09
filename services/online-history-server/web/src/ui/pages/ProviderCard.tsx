import { useOhsStore } from '../context';
import { Button } from '../components/Button';
import { StatusDot } from '../components/StatusDot';
import { FilterBar } from '../components/FilterBar';
import { InstrumentPicker } from '../components/InstrumentPicker';
import type { ConnectionDto } from '../../core/types';
import styles from './ProviderCard.module.css';

export function ProviderCard({ connection }: { connection: ConnectionDto }) {
  const store = useOhsStore();
  const connected = connection.status === 'connected';

  return (
    <section className={styles.card}>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>{connection.name}</h2>
          <span className={styles.kind}>
            {connection.kind} · source #{connection.sourceId}
          </span>
        </div>
        <div className={styles.headRight}>
          <StatusDot status={connection.status} />
          {connected ? (
            <Button variant="danger" onClick={() => store.disconnect(connection.connectionId)}>
              Отключить
            </Button>
          ) : (
            <Button variant="primary" onClick={() => store.connect(connection.connectionId)}>
              Подключить
            </Button>
          )}
        </div>
      </header>

      {!connected && (
        <p className={styles.hint}>Подключись, чтобы стартовать запись инструментов.</p>
      )}

      <FilterBar />
      <InstrumentPicker connection={connection} />
    </section>
  );
}
