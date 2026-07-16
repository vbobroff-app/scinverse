import {
  NotificationDock,
  createOffsetFormatTs,
  formatTsUtc,
} from '@scinverse/notification-center';
import {
  notificationBus,
  notificationDockOpen$,
} from '../../core/notifications';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import styles from './NotificationCenterHost.module.css';

/**
 * Встраивание пакета notification-center в OHS.
 *
 * Колокольчик (visibility) и expand/collapse дока — разные оси:
 * - open=false → док не монтируется (не виден);
 * - open=true → док виден и всегда стартует Collapsed (только заголовок);
 * - Expanded внутри дока — 30% высоты окна или высота после resize пользователя.
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
        defaultExpanded={false}
      />
    </div>
  );
}
