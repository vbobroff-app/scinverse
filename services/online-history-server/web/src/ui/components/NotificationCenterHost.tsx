import { useCallback, useEffect, useState } from 'react';
import {
  NotificationDock,
  createOffsetFormatTs,
  formatTsUtc,
  type DockDateRangeProps,
  type NotificationDockFiltersSnapshot,
  type NotificationDockSettings,
} from '@scinverse/notification-center';
import { notificationDockStore } from '../../core/notificationDockStorage';
import { notificationBus, notificationDockOpen$ } from '../../core/notifications';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { DateRangePicker } from './DateRangePicker';
import styles from './NotificationCenterHost.module.css';

const VISIBILITY_MS = 200;

function renderDockDateRange({ from, to, onApply, onReset }: DockDateRangeProps) {
  // Тот же календарь диапазона, что в провайдерах; onReset закрывает всплывающий календарь.
  return <DateRangePicker from={from} to={to} onApply={onApply} onReset={onReset} />;
}

/**
 * Встраивание пакета notification-center в OHS.
 * open / expanded / фильтры / settings — {@link notificationDockStore} (+ localStorage).
 */
export function NotificationCenterHost() {
  const store = useOhsStore();
  const open = useBehavior(notificationDockOpen$);
  const expanded = useBehavior(notificationDockStore.expanded$);
  const filter = useBehavior(notificationDockStore.filter$);
  const activeFilters = useBehavior(notificationDockStore.activeFilters$);
  const settings = useBehavior(notificationDockStore.settings$);
  const tz = useBehavior(store.displayTz$);
  const formatTs = tz.offsetMin === 0 ? formatTsUtc : createOffsetFormatTs(tz.offsetMin);

  const [rendered, setRendered] = useState(open);
  const [shown, setShown] = useState(open);

  const onFiltersChange = useCallback((snapshot: NotificationDockFiltersSnapshot) => {
    notificationDockStore.applyFiltersSnapshot(snapshot);
  }, []);

  const onSettingsChange = useCallback((next: NotificationDockSettings) => {
    notificationDockStore.setSettings(next);
  }, []);

  const onExpandedChange = useCallback((next: boolean) => {
    notificationDockStore.setExpanded(next);
  }, []);

  useEffect(() => {
    if (open) {
      setRendered(true);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setShown(true));
      });
      return () => cancelAnimationFrame(id);
    }

    setShown(false);
    const timer = window.setTimeout(() => setRendered(false), VISIBILITY_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!rendered) {
    return null;
  }

  return (
    <div
      className={[styles.slot, shown ? styles.slotShown : styles.slotHidden].join(' ')}
      aria-hidden={!shown}
    >
      <NotificationDock
        bus={notificationBus}
        formatTs={formatTs}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        filters={{ filter, activeFilters }}
        onFiltersChange={onFiltersChange}
        settings={settings}
        onSettingsChange={onSettingsChange}
        renderDateRange={renderDockDateRange}
      />
    </div>
  );
}
