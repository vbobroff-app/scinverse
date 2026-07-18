import { useEffect, useRef, useState } from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { ConnectionLane } from '../components/ConnectionLane';
import { ConnectionToggle } from '../components/ConnectionToggle';
import { FilterBar } from '../components/FilterBar';
import { InstrumentPicker } from '../components/InstrumentPicker';
import type { ConnectionDto } from '../../core/types';
import styles from './ProviderCard.module.css';

export function ProviderCard({ connection }: { connection: ConnectionDto }) {
  const store = useOhsStore();
  const showFilters = useBehavior(store.showFilters$);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }
    const onDoc = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [settingsOpen]);

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
          <div className={styles.settingsWrap} ref={settingsRef}>
            <button
              type="button"
              className={[styles.settingsBtn, settingsOpen ? styles.settingsBtnActive : '']
                .filter(Boolean)
                .join(' ')}
              title="Настройки"
              aria-label="Настройки"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((o) => !o)}
            >
              <svg
                className={styles.settingsIcon}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            {settingsOpen && (
              <div className={styles.settingsPopover} role="menu" aria-label="Настройки провайдера">
                <div className={styles.settingsSection}>
                  <span className={styles.settingsSectionTitle}>Показывать</span>
                  <label className={styles.settingsCheck}>
                    <input
                      type="checkbox"
                      checked={showFilters}
                      onChange={() => store.setShowFilters(!showFilters)}
                    />
                    Панель фильтров
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <ConnectionLane connection={connection} />
      {showFilters && <FilterBar />}
      <InstrumentPicker connection={connection} />
    </section>
  );
}
