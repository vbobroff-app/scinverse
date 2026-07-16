import {
  notificationBus,
  notificationDockOpen$,
  toggleNotificationDock,
} from '../../core/notifications';
import { navSectionsByGroup, type NavGroup, type NavSection } from '../../core/navigation';
import { useOhsStore } from '../context';
import { useBehavior, useObservable } from '../hooks/useObservable';
import { NAV_ICONS } from '../navigation';
import styles from './IconSidebar.module.css';

/**
 * Левый вертикальный рейл (стиль Финам): иконки разделов верхнего уровня.
 * Основные разделы сверху, служебные (помощь/уведомления/пользователь) — снизу.
 * Колокольчик не меняет секцию — toggle видимости центра уведомлений (всегда открывается Collapsed).
 */
export function IconSidebar() {
  const store = useOhsStore();
  const active = useBehavior(store.activeSection$);
  const dockOpen = useBehavior(notificationDockOpen$);
  const unread = useObservable(notificationBus.unreadAlertCount$, notificationBus.unreadAlertCount);

  const renderGroup = (group: NavGroup) =>
    navSectionsByGroup(group).map((section) => {
      const isNotifications = section.id === 'notifications';
      return (
        <RailButton
          key={section.id}
          section={section}
          active={isNotifications ? dockOpen : section.id === active}
          badge={isNotifications && unread > 0 ? unread : undefined}
          onSelect={() => {
            if (isNotifications) {
              toggleNotificationDock();
              return;
            }
            store.setActiveSection(section.id);
          }}
        />
      );
    });

  return (
    <nav className={styles.rail} aria-label="Разделы">
      <div className={styles.brandMark} title="Scinverse">
        S
      </div>
      <div className={styles.group}>{renderGroup('top')}</div>
      <div className={styles.spacer} />
      <div className={styles.group}>{renderGroup('bottom')}</div>
    </nav>
  );
}

interface RailButtonProps {
  section: NavSection;
  active: boolean;
  badge?: number;
  onSelect: () => void;
}

function RailButton({ section, active, badge, onSelect }: RailButtonProps) {
  const Icon = NAV_ICONS[section.id];
  const className = [styles.btn, active ? styles.active : '', section.ready ? '' : styles.pending]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={className}
      onClick={onSelect}
      title={section.ready ? section.label : `${section.label} · скоро`}
      aria-label={section.label}
      aria-current={active ? 'page' : undefined}
      aria-pressed={section.id === 'notifications' ? active : undefined}
    >
      <Icon className={styles.icon} />
      {badge !== undefined && (
        <span className={styles.badge}>{badge > 99 ? '99+' : badge}</span>
      )}
    </button>
  );
}
