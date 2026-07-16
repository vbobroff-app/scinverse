import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  NotificationInteraction,
  NotificationLocalization,
  NotificationSeverity,
} from '../types';
import { SeverityIcon } from './SeverityIcon';
import styles from './DockFilters.module.css';

export type DockFilterKey = 'severity' | 'interaction' | 'localization';

export interface DockFilterState {
  severities: NotificationSeverity[];
  interactions: NotificationInteraction[];
  localizations: NotificationLocalization[];
  query: string;
}

export const EMPTY_DOCK_FILTER: DockFilterState = {
  severities: [],
  interactions: [],
  localizations: [],
  query: '',
};

interface Props {
  value: DockFilterState;
  onChange: (next: DockFilterState) => void;
  /** Показанные плашки ([+] меню) — controlled, как activeFilters у провайдеров. */
  activeFilters: DockFilterKey[];
  onActiveFiltersChange: (keys: DockFilterKey[]) => void;
  /** Счётчик «Найдено: N» справа, как в FilterBar провайдера. */
  total?: number;
}

type OpenKey = 'add' | DockFilterKey | null;

interface FilterOption {
  id: string;
  label: string;
  icon?: ReactNode;
}

interface ChipSpec {
  key: DockFilterKey;
  name: string;
  options: FilterOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

const AVAILABLE: { key: DockFilterKey; name: string }[] = [
  { key: 'severity', name: 'Тип сообщения' },
  { key: 'interaction', name: 'Взаимодействие' },
  { key: 'localization', name: 'Локализация' },
];

const SEVERITY_OPTIONS: FilterOption[] = [
  { id: 'ok', label: 'ок', icon: <SeverityIcon severity="ok" /> },
  { id: 'info', label: 'info', icon: <SeverityIcon severity="info" /> },
  { id: 'warning', label: 'warning', icon: <SeverityIcon severity="warning" /> },
  { id: 'error', label: 'error', icon: <SeverityIcon severity="error" /> },
  { id: 'critical', label: 'critical', icon: <SeverityIcon severity="critical" /> },
];

const INTERACTION_OPTIONS: FilterOption[] = [
  { id: 'user', label: 'Пользовательские' },
  { id: 'system', label: 'Системный' },
  { id: 'resolving', label: 'Резолвинг' },
];

const LOCALIZATION_OPTIONS: FilterOption[] = [
  { id: 'internal', label: 'Внутренние' },
  { id: 'external', label: 'Внешние' },
];

/**
 * Плашки фильтров дока в стиле provider workspace:
 * слева [+] · плашки · [×], справа «Найдено» + поиск с иконкой.
 */
export function DockFilters({
  value,
  onChange,
  activeFilters,
  onActiveFiltersChange,
  total,
}: Props) {
  const [open, setOpen] = useState<OpenKey>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) {
      return;
    }
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(null);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const specs = useMemo<Record<DockFilterKey, ChipSpec>>(
    () => ({
      severity: {
        key: 'severity',
        name: 'Тип сообщения',
        options: SEVERITY_OPTIONS,
        selected: value.severities,
        onChange: (selected) =>
          onChange({ ...value, severities: selected as NotificationSeverity[] }),
      },
      interaction: {
        key: 'interaction',
        name: 'Взаимодействие',
        options: INTERACTION_OPTIONS,
        selected: value.interactions,
        onChange: (selected) =>
          onChange({ ...value, interactions: selected as NotificationInteraction[] }),
      },
      localization: {
        key: 'localization',
        name: 'Локализация',
        options: LOCALIZATION_OPTIONS,
        selected: value.localizations,
        onChange: (selected) =>
          onChange({ ...value, localizations: selected as NotificationLocalization[] }),
      },
    }),
    [value, onChange],
  );

  const toggleOpen = (key: OpenKey) => setOpen((cur) => (cur === key ? null : key));

  const onAdd = (key: DockFilterKey) => {
    if (!activeFilters.includes(key)) {
      onActiveFiltersChange([...activeFilters, key]);
    }
  };

  const onRemove = (key: DockFilterKey) => {
    const nextActive = activeFilters.filter((k) => k !== key);
    let nextValue = value;
    if (key === 'severity') {
      nextValue = { ...value, severities: [] };
    } else if (key === 'interaction') {
      nextValue = { ...value, interactions: [] };
    } else {
      nextValue = { ...value, localizations: [] };
    }
    // Сначала value, потом active — родитель с ref-снимком соберёт атомарно;
    // оба вызова обязаны видеть согласованную пару.
    onChange(nextValue);
    onActiveFiltersChange(nextActive);
    setOpen(null);
  };

  const onClear = () => {
    onChange({
      severities: [],
      interactions: [],
      localizations: [],
      query: value.query,
    });
    onActiveFiltersChange([]);
    setOpen(null);
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.chips}>
        <div className={styles.chipWrap}>
          <button
            type="button"
            className={[styles.iconBtn, open === 'add' ? styles.iconBtnActive : '']
              .filter(Boolean)
              .join(' ')}
            onClick={() => toggleOpen('add')}
            title="Добавить фильтр"
            aria-label="Добавить фильтр"
          >
            +
          </button>
          {open === 'add' && (
            <div className={styles.popover}>
              {AVAILABLE.map((f) => {
                const on = activeFilters.includes(f.key);
                return (
                  <button
                    key={f.key}
                    type="button"
                    className={styles.option}
                    onClick={() => (on ? onRemove(f.key) : onAdd(f.key))}
                  >
                    <span className={styles.checkMark}>{on ? '✓' : ''}</span>
                    {f.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {activeFilters.map((key) => {
          const spec = specs[key];
          const summary = summarize(spec);
          const isOpen = open === key;
          return (
            <div className={styles.chipWrap} key={key}>
              <div
                className={[styles.chip, summary || isOpen ? styles.chipActive : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <button
                  type="button"
                  className={styles.chipBody}
                  onClick={() => toggleOpen(key)}
                  aria-expanded={isOpen}
                >
                  <span className={styles.chipName}>{spec.name}</span>
                  {summary && <span className={styles.chipValue}>: {summary}</span>}
                  <span className={[styles.caret, isOpen ? styles.caretOpen : ''].join(' ')}>▾</span>
                </button>
                <button
                  type="button"
                  className={styles.chipClose}
                  onClick={() => onRemove(key)}
                  title="Убрать фильтр"
                  aria-label={`Убрать фильтр «${spec.name}»`}
                >
                  ×
                </button>
              </div>
              {isOpen && (
                <div className={styles.popover}>
                  {spec.options.map((o) => {
                    const checked = spec.selected.includes(o.id);
                    return (
                      <label key={o.id} className={styles.check}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(spec.selected);
                            if (e.target.checked) {
                              next.add(o.id);
                            } else {
                              next.delete(o.id);
                            }
                            spec.onChange([...next]);
                          }}
                        />
                        {o.icon && <span className={styles.optionIcon}>{o.icon}</span>}
                        {o.label}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        <button
          type="button"
          className={styles.iconBtn}
          onClick={onClear}
          disabled={activeFilters.length === 0}
          title="Сбросить все фильтры"
          aria-label="Сбросить все фильтры"
        >
          ×
        </button>
      </div>

      <div className={styles.right}>
        {total !== undefined && <span className={styles.total}>Найдено: {total}</span>}
        <div className={styles.searchWrap}>
          <svg className={styles.searchIcon} viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              d="M7 2a5 5 0 1 1 0 10A5 5 0 0 1 7 2Zm3.5 8.5L14 14"
            />
          </svg>
          <input
            className={[styles.search, value.query ? styles.searchWithClear : '']
              .filter(Boolean)
              .join(' ')}
            type="text"
            placeholder="Поиск…"
            value={value.query}
            onChange={(e) => onChange({ ...value, query: e.target.value })}
            autoComplete="off"
          />
          {value.query && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => onChange({ ...value, query: '' })}
              title="Очистить поиск"
              aria-label="Очистить поиск"
            >
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function summarize(spec: ChipSpec): string | undefined {
  const labels = spec.selected.map((id) => spec.options.find((o) => o.id === id)?.label ?? id);
  return labels.length > 0 ? labels.join(', ') : undefined;
}
