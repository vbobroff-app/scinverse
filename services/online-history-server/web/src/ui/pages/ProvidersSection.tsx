import { useEffect } from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { ConnectionsPanel } from './ConnectionsPanel';
import { ProviderCard } from './ProviderCard';
import styles from './ProvidersSection.module.css';

/**
 * Раздел «Провайдеры»: слева — список подключений, в рабочей области — карточка провайдера
 * с фильтрами и Гантом. Выбранный провайдер живёт в сторе (переживает переход между разделами
 * и перезагрузку) — иначе возврат в раздел сбрасывал бы выбор на первый провайдер.
 */
export function ProvidersSection() {
  const store = useOhsStore();
  const connections = useBehavior(store.connections$);
  const selectedId = useBehavior(store.activeConnectionId$);

  // Автовыбор первого провайдера, если ничего не выбрано или сохранённый id больше не существует.
  useEffect(() => {
    if (connections.length === 0) {
      return;
    }
    if (selectedId === null || !connections.some((c) => c.connectionId === selectedId)) {
      store.setActiveConnection(connections[0].connectionId);
    }
  }, [connections, selectedId, store]);

  const selected = connections.find((c) => c.connectionId === selectedId) ?? null;

  return (
    <div className={styles.layout}>
      <ConnectionsPanel selectedId={selectedId} onSelect={(id) => store.setActiveConnection(id)} />
      {selected ? (
        <ProviderCard connection={selected} />
      ) : (
        <div className={styles.placeholder}>Выбери провайдера слева.</div>
      )}
    </div>
  );
}
