import {
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_SOURCE_TYPES,
  type NotificationSeverity,
  type NotificationSourceType,
} from '../types';
import styles from './DockFilters.module.css';

export interface DockFilterState {
  severities: NotificationSeverity[];
  sourceTypes: NotificationSourceType[];
  query: string;
}

interface Props {
  value: DockFilterState;
  modules: string[];
  selectedModules: string[];
  onChange: (next: DockFilterState) => void;
  onModulesChange: (modules: string[]) => void;
}

function toggleIn<T extends string>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function DockFilters({ value, modules, selectedModules, onChange, onModulesChange }: Props) {
  return (
    <div className={styles.root}>
      <div className={styles.group} role="group" aria-label="Уровень">
        {NOTIFICATION_SEVERITIES.map((s) => (
          <button
            key={s}
            type="button"
            className={[styles.chip, value.severities.includes(s) ? styles.chipOn : ''].filter(Boolean).join(' ')}
            onClick={() => onChange({ ...value, severities: toggleIn(value.severities, s) })}
          >
            {s}
          </button>
        ))}
      </div>
      <div className={styles.group} role="group" aria-label="Тип">
        {NOTIFICATION_SOURCE_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className={[styles.chip, value.sourceTypes.includes(t) ? styles.chipOn : ''].filter(Boolean).join(' ')}
            onClick={() => onChange({ ...value, sourceTypes: toggleIn(value.sourceTypes, t) })}
          >
            {t}
          </button>
        ))}
      </div>
      {modules.length > 0 && (
        <div className={styles.group} role="group" aria-label="Модуль">
          {modules.map((m) => (
            <button
              key={m}
              type="button"
              className={[styles.chip, selectedModules.includes(m) ? styles.chipOn : ''].filter(Boolean).join(' ')}
              onClick={() => onModulesChange(toggleIn(selectedModules, m))}
              title={m}
            >
              {m}
            </button>
          ))}
        </div>
      )}
      <input
        className={styles.search}
        type="search"
        placeholder="Поиск…"
        value={value.query}
        onChange={(e) => onChange({ ...value, query: e.target.value })}
      />
    </div>
  );
}
