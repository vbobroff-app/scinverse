import { useEffect, useState } from 'react';
import { useOhsStore } from './ui/context';
import { useBehavior } from './ui/hooks/useObservable';
import { HeaderControls } from './ui/components/HeaderControls';
import { ConnectionsPanel } from './ui/pages/ConnectionsPanel';
import { ProviderCard } from './ui/pages/ProviderCard';
import styles from './App.module.css';

export function App() {
  const store = useOhsStore();
  const connections = useBehavior(store.connections$);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Автовыбор первого провайдера, пока ничего не выбрано.
  useEffect(() => {
    if (selectedId === null && connections.length > 0) {
      setSelectedId(connections[0].connectionId);
    }
  }, [connections, selectedId]);

  const handleSelect = (id: number | null) => setSelectedId(id);

  const selected = connections.find((c) => c.connectionId === selectedId) ?? null;

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo}>Scinverse</span>
          <span className={styles.sub}>OHS · админка записи</span>
        </div>
        <HeaderControls />
      </header>

      <main className={styles.main}>
        <ConnectionsPanel selectedId={selectedId} onSelect={handleSelect} />
        {selected ? (
          <ProviderCard connection={selected} />
        ) : (
          <div className={styles.placeholder}>Выбери провайдера слева.</div>
        )}
      </main>
    </div>
  );
}
