import { useCallback, useEffect, useState } from 'react';
import {
  NotificationDock,
  createOffsetFormatTs,
  formatTsUtc,
  type NotificationDockFiltersSnapshot,
} from '@scinverse/notification-center';
import { notificationDockStore } from '../../core/notificationDockStorage';
import { notificationBus, notificationDockOpen$ } from '../../core/notifications';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import styles from './NotificationCenterHost.module.css';

const VISIBILITY_MS = 200;

/**
 * Встраивание пакета notification-center в OHS.
 * open / expanded / фильтры — {@link notificationDockStore} (+ localStorage).
 */
export function NotificationCenterHost() {
  const store = useOhsStore();
  const open = useBehavior(notificationDockOpen$);
  const expanded = useBehavior(notificationDockStore.expanded$);
  const filter = useBehavior(notificationDockStore.filter$);
  const activeFilters = useBehavior(notificationDockStore.activeFilters$);
  const tz = useBehavior(store.displayTz$);
  const formatTs = tz.offsetMin === 0 ? formatTsUtc : createOffsetFormatTs(tz.offsetMin);

  const [rendered, setRendered] = useState(open);
  const [shown, setShown] = useState(open);

  const onFiltersChange = useCallback((snapshot: NotificationDockFiltersSnapshot) => {
    notificationDockStore.applyFiltersSnapshot(snapshot);
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
      />
    </div>
  );
}
