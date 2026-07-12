import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { navSectionsByGroup, type NavGroup, type NavSection } from '../../core/navigation';
import { NAV_ICONS } from '../navigation';
import styles from './IconSidebar.module.css';

/**
 * Левый вертикальный рейл (стиль Финам): иконки разделов верхнего уровня.
 * Основные разделы сверху, служебные (помощь/уведомления/пользователь) — снизу.
 * Клик переключает активный раздел в `OhsStore.activeSection$`.
 */
export function IconSidebar() {
  const store = useOhsStore();
  const active = useBehavior(store.activeSection$);

  const renderGroup = (group: NavGroup) =>
    navSectionsByGroup(group).map((section) => (
      <RailButton
        key={section.id}
        section={section}
        active={section.id === active}
        onSelect={() => store.setActiveSection(section.id)}
      />
    ));

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
  onSelect: () => void;
}

function RailButton({ section, active, onSelect }: RailButtonProps) {
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
    >
      <Icon className={styles.icon} />
    </button>
  );
}
