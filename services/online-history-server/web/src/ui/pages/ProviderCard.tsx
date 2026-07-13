import { useOhsStore } from '../context';
import { ConnectionToggle } from '../components/ConnectionToggle';
import { FilterBar } from '../components/FilterBar';
import { InstrumentPicker } from '../components/InstrumentPicker';
import type { ConnectionDto } from '../../core/types';
import styles from './ProviderCard.module.css';

export function ProviderCard({ connection }: { connection: ConnectionDto }) {
  const store = useOhsStore();

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
          <ConnectionToggle
            status={connection.status}
            onConnect={() => store.connect(connection.connectionId)}
            onDisconnect={() => store.disconnect(connection.connectionId)}
            onCancelConnect={() => store.cancelConnect(connection.connectionId)}
          />
        </div>
      </header>

      <FilterBar />
      <InstrumentPicker connection={connection} />
    </section>
  );
}
