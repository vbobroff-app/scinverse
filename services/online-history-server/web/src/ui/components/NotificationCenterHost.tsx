import {
  NotificationDock,
  createOffsetFormatTs,
  formatTsUtc,
} from '@scinverse/notification-center';
import {
  notificationBus,
  notificationDockOpen$,
  setNotificationDockOpen,
} from '../../core/notifications';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import styles from './NotificationCenterHost.module.css';

/**
 * Встраивание пакета notification-center в OHS:
 * док снизу + формат времени из системного `displayTz$`.
 */
export function NotificationCenterHost() {
  const store = useOhsStore();
  const open = useBehavior(notificationDockOpen$);
  const tz = useBehavior(store.displayTz$);
  const formatTs = tz.offsetMin === 0 ? formatTsUtc : createOffsetFormatTs(tz.offsetMin);

  if (!open) {
    return null;
  }

  return (
    <div className={styles.slot}>
      <NotificationDock
        bus={notificationBus}
        formatTs={formatTs}
        expanded
        onExpandedChange={(next) => {
          if (!next) {
            setNotificationDockOpen(false);
          }
        }}
      />
    </div>
  );
}
