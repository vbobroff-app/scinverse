import { useEffect, useRef, useState } from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ConnectionLane } from '../components/ConnectionLane';
import { ConnectionToggle } from '../components/ConnectionToggle';
import { BasketEditorModal } from '../components/BasketEditorModal';
import { FilterBar } from '../components/FilterBar';
import { InstrumentPicker } from '../components/InstrumentPicker';
import type { ConnectionDto } from '../../core/types';
import styles from './ProviderCard.module.css';

function catalogRefreshMessage(sessionLive: boolean): string {
  const body =
    'Будет выполнено:\n' +
    '• инвалидация кэша dump-справочника;\n' +
    '• архивация просроченных инструментов по дате экспирации;\n' +
    '• сброс окон опционов (ATM) — при следующем раскрытии серии загрузка заново.\n\n' +
    'Invalidate и sweep — обычно секунды. UI не блокируется.';
  if (sessionLive) {
    return (
      body +
      '\n\nСейчас сессия уже connected: полный dump справочника текущая сессия не повторит. ' +
      'Нужен reconnect (Disconnect → Connect), типично ~10–20 с разбора.'
    );
  }
  return (
    body +
    '\n\nПолный dump справочника придёт при следующем connect (типично ~10–20 с разбора).'
  );
}

function isSessionLive(status: string): boolean {
  return status === 'waiting' || status === 'active' || status === 'degraded' || status === 'connecting';
}

export function ProviderCard({ connection }: { connection: ConnectionDto }) {
  const store = useOhsStore();
  const showFilters = useBehavior(store.showFilters$);
  const showNowMarker = useBehavior(store.showNowMarker$);
  const showLinkRibbon = useBehavior(store.showLinkRibbon$);
  const showRuler = useBehavior(store.showRuler$);
  const showBreakIncidents = useBehavior(store.showBreakIncidents$);
  const showCrashIncidents = useBehavior(store.showCrashIncidents$);
  const showWorkGaps = useBehavior(store.showWorkGaps$);
  const showWriteGaps = useBehavior(store.showWriteGaps$);
  const showScheduleMask = useBehavior(store.showScheduleMask$);
  const ohsUnavailable = useBehavior(store.backendOutage$);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshConfirmOpen, setRefreshConfirmOpen] = useState(false);
  const [basketEditor, setBasketEditor] = useState<{ open: boolean; basketId: number | null }>({
    open: false,
    basketId: null,
  });
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
            ohsUnavailable={ohsUnavailable}
            onConnect={() => store.connect(connection.connectionId)}
            onDisconnect={() => store.disconnect(connection.connectionId)}
            onCancelConnect={() => store.cancelConnect()}
          />
          <button
            type="button"
            className={styles.settingsBtn}
            title="Обновить справочник"
            aria-label="Обновить справочник"
            onClick={() => {
              setSettingsOpen(false);
              setRefreshConfirmOpen(true);
            }}
          >
            <svg
              className={styles.settingsIcon}
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M0 0h24v24H0z" fill="none" />
              <path
                fill="currentColor"
                d="M12 3c4.42 0 8 1.79 8 4s-3.58 4-8 4s-8-1.79-8-4s3.58-4 8-4M4 9c0 2.21 3.58 4 8 4c1.11 0 2.18-.11 3.14-.32c-.95.86-1.64 1.99-1.96 3.28L12 16c-4.42 0-8-1.79-8-4zm16 0v2h-.5l-.6.03c.7-.6 1.1-1.29 1.1-2.03M4 14c0 2.21 3.58 4 8 4l1-.03c.09 1.06.42 2.03.95 2.91L12 21c-4.42 0-8-1.79-8-4zm15-.5c1.11 0 2.11.45 2.83 1.17L23 13.5v4h-4l1.77-1.77A2.5 2.5 0 1 0 21 19h1.71A3.99 3.99 0 0 1 19 21.5c-2.21 0-4-1.79-4-4s1.79-4 4-4"
              />
            </svg>
          </button>
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
                  <span className={styles.settingsSectionTitle}>Общие</span>
                  <label className={styles.settingsCheck}>
                    <input
                      type="checkbox"
                      checked={showNowMarker}
                      onChange={() => store.setShowNowMarker(!showNowMarker)}
                    />
                    Now-маркер
                  </label>
                </div>
                <div className={styles.settingsSection}>
                  <span className={styles.settingsSectionTitle}>Связь</span>
                  <label className={styles.settingsCheck}>
                    <input
                      type="checkbox"
                      checked={showLinkRibbon}
                      onChange={() => store.setShowLinkRibbon(!showLinkRibbon)}
                    />
                    Лента соединения
                  </label>
                  <label className={styles.settingsCheck}>
                    <input
                      type="checkbox"
                      checked={showBreakIncidents}
                      onChange={() => store.setShowBreakIncidents(!showBreakIncidents)}
                    />
                    Инциденты связи
                  </label>
                  <label className={styles.settingsCheck}>
                    <input
                      type="checkbox"
                      checked={showCrashIncidents}
                      onChange={() => store.setShowCrashIncidents(!showCrashIncidents)}
                    />
                    Инциденты сервера
                  </label>
                  <label className={styles.settingsCheck}>
                    <input
                      type="checkbox"
                      checked={showScheduleMask}
                      onChange={() => store.setShowScheduleMask(!showScheduleMask)}
                    />
                    Маска расписания
                  </label>
                  <label className={styles.settingsCheck}>
                    <input
                      type="checkbox"
                      checked={showWorkGaps}
                      onChange={() => store.setShowWorkGaps(!showWorkGaps)}
                    />
                    Гэпы в работе
                  </label>
                  <label className={styles.settingsCheck}>
                    <input
                      type="checkbox"
                      checked={showRuler}
                      onChange={() => store.setShowRuler(!showRuler)}
                    />
                    Линейка
                  </label>
                </div>
                <div className={styles.settingsSection}>
                  <span className={styles.settingsSectionTitle}>Запись</span>
                  <label className={styles.settingsCheck}>
                    <input
                      type="checkbox"
                      checked={showWriteGaps}
                      onChange={() => store.setShowWriteGaps(!showWriteGaps)}
                    />
                    Write Gaps
                  </label>
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
      {showFilters && (
        <FilterBar
          onManageBasket={(basketId) => setBasketEditor({ open: true, basketId })}
        />
      )}
      <InstrumentPicker connection={connection} />

      {refreshConfirmOpen && (
        <ConfirmDialog
          title="Обновить справочник"
          message={catalogRefreshMessage(isSessionLive(connection.status))}
          severity={isSessionLive(connection.status) ? 'warning' : 'info'}
          confirmLabel="ОК"
          cancelLabel="Отмена"
          onConfirm={() => {
            setRefreshConfirmOpen(false);
            store.refreshInstrumentCatalog();
          }}
          onCancel={() => setRefreshConfirmOpen(false)}
        />
      )}

      <BasketEditorModal
        connectionId={connection.connectionId}
        basketId={basketEditor.basketId}
        open={basketEditor.open}
        onClose={() => setBasketEditor({ open: false, basketId: null })}
      />
    </section>
  );
}
