import { useEffect, useState } from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { ConnectionsPanel } from './ConnectionsPanel';
import { ProviderCard } from './ProviderCard';
import styles from './ProvidersSection.module.css';

/**
 * Раздел «Провайдеры»: слева — список подключений, в рабочей области — карточка провайдера
 * с фильтрами и Гантом. Состояние выбранного провайдера локальное (не глобальная навигация).
 */
export function ProvidersSection() {
  const store = useOhsStore();
  const connections = useBehavior(store.connections$);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Автовыбор первого провайдера, пока ничего не выбрано.
  useEffect(() => {
    if (selectedId === null && connections.length > 0) {
      setSelectedId(connections[0].connectionId);
    }
  }, [connections, selectedId]);

  const selected = connections.find((c) => c.connectionId === selectedId) ?? null;

  return (
    <div className={styles.layout}>
      <ConnectionsPanel selectedId={selectedId} onSelect={setSelectedId} />
      {selected ? (
        <ProviderCard connection={selected} />
      ) : (
        <div className={styles.placeholder}>Выбери провайдера слева.</div>
      )}
    </div>
  );
}
